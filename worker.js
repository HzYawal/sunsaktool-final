// ===============================================
//  worker.js (진짜 최종 완성 버전)
// ===============================================
console.log('--- [0/11] 워커 프로세스 시작 ---');

try {
    console.log('[1/11] express 로딩 시도...');
    const express = require('express');
    console.log('[1/11] express 로딩 성공!');

    console.log('[2/11] path 로딩 시도...');
    const path = require('path');
    console.log('[2/11] path 로딩 성공!');

    console.log('[3/11] fs-extra 로딩 시도...');
    const fs = require('fs-extra');
    console.log('[3/11] fs-extra 로딩 성공!');

    console.log('[4/11] child_process 로딩 시도...');
    const { exec } = require('child_process');
    console.log('[4/11] child_process 로딩 성공!');

    console.log('[5/11] node-fetch 로딩 시도...');
    const fetch = require('node-fetch');
    console.log('[5/11] node-fetch 로딩 성공!');

    console.log('[6/11] playwright 로딩 시도...');
    const { chromium } = require('playwright'); 
    console.log('[6/11] playwright 로딩 성공!');

    console.log('[7/11] os 로딩 시도...');
    const os = require('os');
    console.log('[7/11] os 로딩 성공!');

    console.log('[8/11] @google-cloud/pubsub 로딩 시도...');
    const { PubSub } = require('@google-cloud/pubsub');
    console.log('[8/11] @google-cloud/pubsub 로딩 성공!');

    console.log('[9/11] @google-cloud/storage 로딩 시도...');
    const { Storage } = require('@google-cloud/storage');
    console.log('[9/11] @google-cloud/storage 로딩 성공!');

    console.log('[10/11] @google-cloud/firestore 로딩 시도...');
    const { Firestore } = require('@google-cloud/firestore');
    console.log('[10/11] @google-cloud/firestore 로딩 성공!');

    console.log('--- [11/11] 모든 모듈 로딩 성공! 실제 코드 실행 시작 ---');

    const GCP_PROJECT_ID = 'sunsak-tool-gcp';
    const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
    const storage = new Storage({ projectId: GCP_PROJECT_ID });
    const firestore = new Firestore({ projectId: GCP_PROJECT_ID });
    const RENDER_TOPIC_NAME = 'sunsak-render-jobs';
    const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
    const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

    async function updateJobStatus(jobId, status, message, progress = null) {
        const jobRef = firestore.collection('renderJobs').doc(jobId);
        const updateData = { status, message, updatedAt: new Date() };
        if (progress !== null) { updateData.progress = progress; }
        await jobRef.set(updateData, { merge: true });
        console.log(`[${jobId}] 상태 업데이트: ${status} - ${message} (${progress !== null ? progress + '%' : ''})`);
    }

    async function renderVideo(jobId, projectData) {
        console.log(`[${jobId}] --- [A] renderVideo 함수 진입 ---`);
        await updateJobStatus(jobId, 'processing', '렌더링 환경을 설정하고 있습니다.', 5);
        console.log(`[${jobId}] --- [B] 초기 상태 업데이트 완료 ---`);

        const fps = 30;
        const tempDir = path.join(os.tmpdir(), jobId);
        const finalAudioPath = path.join(tempDir, 'final_audio.aac');
        const outputVideoPath = path.join(tempDir, 'output.mp4');
        console.log(`[${jobId}] --- [C] 임시 디렉토리 경로 생성 완료: ${tempDir} ---`);

        const framesDir = path.join(tempDir, 'frames');
        const audioDir = path.join(tempDir, 'audio');
        
        let browser;
        try {
            await fs.ensureDir(tempDir);
            console.log(`[${jobId}] --- [C-1] 기본 임시 디렉토리 생성 완료 ---`);
            await fs.ensureDir(framesDir);
            console.log(`[${jobId}] --- [D] 프레임 디렉토리 생성 완료 ---`);
            await fs.ensureDir(audioDir);
            console.log(`[${jobId}] --- [E] 오디오 디렉토리 생성 완료 ---`);
            await updateJobStatus(jobId, 'processing', '비디오 프레임 캡처를 시작합니다.', 10);
            console.log(`[${jobId}] --- [F] Playwright 실행 시도 ---`);

            browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
            console.log(`[${jobId}] --- [G] Playwright 브라우저 성공적으로 실행됨! ---`);

            const page = await browser.newPage();
            await page.setViewportSize({ width: 1080, height: 1920 });
            const renderTemplateContent = await fs.readFile(path.join(__dirname, 'render_template.html'), 'utf-8');
            await page.setContent(renderTemplateContent, { waitUntil: 'networkidle' });
            
            console.log(`[${jobId}] --- [H] 렌더링에 필요한 모든 폰트를 미리 로드합니다... ---`);
            await page.evaluate(async () => {
                await document.fonts.ready;
            });
            console.log(`[${jobId}] --- [I] 폰트 로딩 완료! 프레임 캡처를 시작합니다. ---`);

            let frameCount = 0;
            let currentPersistentMedia = null;
            const totalFramesToRender = projectData.scriptCards.reduce((sum, card) => sum + Math.floor(card.duration * fps), 0);
            for (const [cardIndex, card] of projectData.scriptCards.entries()) {
                if (card.media.url && card.media.persistUntilCardId) { currentPersistentMedia = { media: card.media, layout: card.layout.media, animations: card.animations.media, endCardId: card.media.persistUntilCardId }; }
                const mediaToRender = currentPersistentMedia ? currentPersistentMedia : { media: card.media, layout: card.layout.media, animations: card.animations.media };
                const cardFrames = Math.floor(card.duration * fps);
                for (let i = 0; i < cardFrames; i++) {
                    const timeInCard = i / fps;
                    
                    await page.evaluate((args) => {
                        const { project, card, mediaInfo, t } = args; const scale = 1080 / project.renderMetadata.sourceWidth; const pSettings = project.projectSettings; const headerEl = document.querySelector('.st-preview-header'); const headerTitleEl = headerEl.querySelector('.header-title'); const headerIconEl = headerEl.querySelector('.header-icon'); const headerLogoEl = headerEl.querySelector('.header-logo'); headerEl.style.height = `${65 * scale}px`; headerEl.style.padding = `0 ${15 * scale}px`; headerEl.style.backgroundColor = pSettings.header.backgroundColor; headerTitleEl.innerText = pSettings.header.text; headerTitleEl.style.color = pSettings.header.color; headerTitleEl.style.fontFamily = pSettings.header.fontFamily; headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`; const iconSVG = { back: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`, menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>` }; headerIconEl.innerHTML = iconSVG[pSettings.header.icon] || ''; if (pSettings.header.logo.url) { headerLogoEl.src = pSettings.header.logo.url; headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.display = 'block'; } else { headerLogoEl.style.display = 'none'; } const projectInfoEl = document.querySelector('.st-project-info'); projectInfoEl.style.paddingBottom = `${16 * scale}px`; projectInfoEl.style.marginBottom = `${16 * scale}px`; const projectInfoTitleEl = projectInfoEl.querySelector('.title'); projectInfoTitleEl.innerText = pSettings.project.title; projectInfoTitleEl.style.color = pSettings.project.titleColor; projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily; projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`; projectInfoTitleEl.style.marginBottom = `${5 * scale}px`; const projectInfoSpanEl = projectInfoEl.querySelector('span'); projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`; projectInfoSpanEl.style.color = pSettings.project.metaColor; projectInfoSpanEl.style.fontSize = `${13 * scale}px`; const textWrapper = document.querySelector('#st-preview-text-container-wrapper'); const textEl = document.querySelector('#st-preview-text'); const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper'); const imageEl = document.querySelector('#st-preview-image'); const videoEl = document.querySelector('#st-preview-video'); const scaledStyle = { ...card.style }; scaledStyle.fontSize = `${parseFloat(card.style.fontSize) * scale}px`; scaledStyle.lineHeight = card.style.lineHeight; scaledStyle.letterSpacing = `${parseFloat(card.style.letterSpacing) * scale}px`; Object.assign(textEl.style, scaledStyle); textWrapper.style.transform = `translate(${card.layout.text.x * scale}px, ${card.layout.text.y * scale}px) scale(${card.layout.text.scale || 1}) rotate(${card.layout.text.angle || 0}deg)`; let showMedia = false; if(mediaInfo.media && mediaInfo.media.url) { const showOnSegmentIndex = mediaInfo.media.showOnSegment - 1; const showTime = (card.segments[showOnSegmentIndex] || {startTime: 0}).startTime; if (t >= showTime) showMedia = true; } if(showMedia) { mediaWrapper.style.display = 'flex'; mediaWrapper.style.transform = `translate(${mediaInfo.layout.x * scale}px, ${mediaInfo.layout.y * scale}px) scale(${mediaInfo.layout.scale || 1}) rotate(${mediaInfo.layout.angle || 0}deg)`; if (mediaInfo.media.type === 'video') { imageEl.style.display = 'none'; videoEl.style.display = 'block'; videoEl.style.objectFit = mediaInfo.media.fit; if (videoEl.src !== mediaInfo.media.url) videoEl.src = mediaInfo.media.url; videoEl.currentTime = (mediaInfo.media.startTime || 0) + t; } else { videoEl.style.display = 'none'; imageEl.style.display = 'block'; imageEl.style.objectFit = mediaInfo.media.fit; if (imageEl.src !== mediaInfo.media.url) imageEl.src = mediaInfo.media.url; } } else { mediaWrapper.style.display = 'none'; } textEl.innerHTML = ''; const hasCustomSequence = card.animationSequence && card.animationSequence.length > 0; if (hasCustomSequence) { (card.segments || []).forEach(segment => { if (t >= segment.startTime) { const p = document.createElement('p'); p.textContent = segment.text || ' '; p.style.margin = 0; textEl.appendChild(p); } }); } else { card.text.split('\n').forEach(line => { const p = document.createElement('p'); p.textContent = line || ' '; p.style.margin = 0; textEl.appendChild(p); }); } const applyAnimation = (el, anims, duration, time) => { const baseTransform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY') && !s.startsWith('scale')).join(' '); el.style.opacity = 1; el.style.transform = baseTransform; const inDuration = anims.in.duration; const outStartTime = duration - anims.out.duration; let progress, newTransform = ''; if (time < inDuration && anims.in.name !== 'none') { progress = Math.min(1, time / inDuration); if(anims.in.name === 'fadeIn') el.style.opacity = progress; if(anims.in.name === 'slideInUp') newTransform = ` translateY(${(1 - progress) * 50 * scale}px)`; if(anims.in.name === 'zoomIn') { el.style.opacity = progress; newTransform = ` scale(${0.8 + 0.2 * progress})`; } } else if (time >= outStartTime && anims.out.name !== 'none') { progress = Math.min(1, (time - outStartTime) / anims.out.duration); if(anims.out.name === 'fadeOut') el.style.opacity = 1 - progress; if(anims.out.name === 'slideOutDown') newTransform = ` translateY(${progress * 50 * scale}px)`; if(anims.out.name === 'zoomOut') { el.style.opacity = 1 - progress; newTransform = ` scale(${1 - 0.2 * progress})`; } } el.style.transform = `${baseTransform} ${newTransform}`; }; applyAnimation(textWrapper, card.animations.text, card.duration, t); if(showMedia) applyAnimation(mediaWrapper, mediaInfo.animations, card.duration, t);
                    }, { project: projectData, card: card, mediaInfo: mediaToRender, t: timeInCard });
                    
                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                    const currentProgress = 10 + Math.floor((frameCount / totalFramesToRender) * 40);
                    if(frameCount % 30 === 0) { await updateJobStatus(jobId, 'processing', `${cardIndex + 1}번째 클립 렌더링 중...`, currentProgress); }
                }
                if (currentPersistentMedia && currentPersistentMedia.endCardId === card.id) currentPersistentMedia = null;
            }
            await browser.close();
            await updateJobStatus(jobId, 'processing', '오디오 트랙을 처리하고 있습니다.', 55);

            const audioRenderPromise = (async () => {
                const audioTracks = []; let currentTime = 0;
                if (projectData.globalBGM && projectData.globalBGM.url) { try { const response = await fetch(projectData.globalBGM.url); const path = `${audioDir}/bgm.mp3`; await fs.writeFile(path, await response.buffer()); audioTracks.push({ type: 'bgm', path, volume: projectData.globalBGM.volume || 0.3 }); } catch (e) { console.error('BGM 다운로드 실패:', e); } }
                for (const [index, card] of projectData.scriptCards.entries()) {
                    if (card.audioUrl && card.audioUrl.startsWith('data:audio/')) { try { const ttsPath = `${audioDir}/tts_${index}.mp3`; const base64Data = card.audioUrl.split(',')[1]; await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64')); audioTracks.push({ type: 'effect', path: ttsPath, time: currentTime, volume: card.ttsVolume || 1.0 }); } catch (e) { console.error('TTS Base64 파일 저장 실패:', e); } }
                    if (card.sfxUrl) { try { const response = await fetch(card.sfxUrl); const sfxPath = `${audioDir}/sfx_${index}.mp3`; await fs.writeFile(sfxPath, await response.buffer()); audioTracks.push({ type: 'effect', path: sfxPath, time: currentTime, volume: card.sfxVolume || 1.0 }); } catch (e) { console.error('SFX 다운로드 실패:', e); } }
                    currentTime += card.duration;
                }
                if (audioTracks.length === 0) return;
                const inputClauses = audioTracks.map(t => `-i "${t.path}"`).join(' ');
                let filterComplex = '';
                if (audioTracks.length > 1) { const outputStreams = []; audioTracks.forEach((track, i) => { let stream = `[${i}:a]`; if (track.type === 'bgm') { stream += `volume=${track.volume}[a${i}]`; } else { stream += `volume=${track.volume},adelay=${track.time * 1000}|${track.time * 1000}[a${i}]`; } filterComplex += stream; outputStreams.push(`[a${i}]`); if(i < audioTracks.length - 1) filterComplex += ';'; }); filterComplex += `;${outputStreams.join('')}amix=inputs=${outputStreams.length}:duration=longest`; } else { const track = audioTracks[0]; filterComplex = `[0:a]volume=${track.volume}`; }
                const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
                await new Promise((resolve, reject) => exec(mixCommand, (error, stdout, stderr) => { if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(new Error(stderr)); } resolve(stdout); }));
            })();
            await audioRenderPromise;
            await updateJobStatus(jobId, 'processing', '최종 영상으로 합성하고 있습니다.', 80);
            const hasAudio = await fs.pathExists(finalAudioPath);
            const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
            const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
            await new Promise((resolve, reject) => exec(ffmpegCommand, (err, stdout, stderr) => { if (err) { console.error('FFMPEG 최종 합성 오류:', stderr); reject(new Error(stderr)); } else resolve(stdout); }));
            
            await updateJobStatus(jobId, 'processing', '완성된 영상을 스토리지에 업로드합니다.', 95);
            const destination = `videos/${jobId}/${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`;

            // [최종 수정] 버킷 자체가 공개이므로, 어떤 옵션도 필요 없이 간단하게 업로드만 합니다.
            await storage.bucket(OUTPUT_BUCKET_NAME).upload(outputVideoPath, {
                destination: destination,
            });

            const videoUrl = `https://storage.googleapis.com/${OUTPUT_BUCKET_NAME}/${destination}`;
            
            await updateJobStatus(jobId, 'completed', '영상 제작이 완료되었습니다.', 100);
            await firestore.collection('renderJobs').doc(jobId).set({ videoUrl, completedAt: new Date() }, { merge: true });
            
            console.log(`[${jobId}] 작업 완료! 최종 영상 URL: ${videoUrl}`);
        } catch (error) {
            console.error(`[${jobId}] 렌더링 워커에서 심각한 오류 발생! 상세 정보:`, error.stack);
            await updateJobStatus(jobId, 'failed', `치명적 오류: ${error.message}. 서버 로그를 확인하세요.`);
        } finally {
            if (browser) await browser.close();
            if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
            console.log(`[${jobId}] 임시 파일 정리를 완료했습니다.`);
        }
    }

    async function listenForMessages() {
        try {
            const subscription = pubSubClient.subscription(SUBSCRIPTION_NAME);
            const messageHandler = async (message) => {
                console.log(`[Pub/Sub] 수신된 메시지 ID: ${message.id}`);
                try {
                    const { jobId, projectData } = JSON.parse(message.data);
                    console.log(`[${jobId}] 렌더링 작업 처리 시작`);
                    await renderVideo(jobId, projectData);
                    message.ack();
                    console.log(`[${jobId}] 메시지 처리 완료 (ack)`);
                } catch (error) {
                    console.error('[Pub/Sub] 메시지 처리 중 심각한 오류:', error.stack);
                    message.ack();
                }
            };
            const errorHandler = (error) => { console.error(`[Pub/Sub] 심각한 리스너 오류 발생:`, error); };
            subscription.on('message', messageHandler);
            subscription.on('error', errorHandler);
            console.log(`=======================================================`);
            console.log(`  SunsakTool 렌더링 워커가 성공적으로 시작되었습니다.`);
            console.log(`  Pub/Sub 구독(${SUBSCRIPTION_NAME})을 수신 대기합니다...`);
            console.log(`=======================================================`);
        } catch (error) {
            console.error('Pub/Sub 리스너 설정 중 치명적인 오류 발생:', error);
        }
    }

    const app = express();
    const PORT = process.env.PORT || 3000;
    app.get('/', (req, res) => { res.status(200).send('SunsakTool Worker is alive and listening for jobs.'); });
    app.listen(PORT, () => {
      console.log(`워커 Health Check 서버가 ${PORT} 포트에서 실행되었습니다.`);
      listenForMessages();
    });

} catch (e) {
    console.error('--- [!!!] 최상위 레벨에서 모듈 로딩 중 치명적인 오류 발생 ---');
    console.error(e.stack);
}
