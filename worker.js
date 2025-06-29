// ▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 worker.js 전체를 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼

// ===============================================
//  worker.js (Playwright 최종 완성 버전 - 생략 없음)
// ===============================================
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const os = require('os');
const playwright = require('playwright');

const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

// --- 환경 설정 ---
const GCP_PROJECT_ID = process.env.GCP_PROJECT || 'sunsak-tool-gcp';
const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
const storage = new Storage({ projectId: GCP_PROJECT_ID });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });

const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
const JOB_DATA_BUCKET_NAME = 'sunsak-job-data';
const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

// --- 헬퍼 함수 ---
async function updateJobStatus(jobId, status, message, progress = null) {
    const jobRef = firestore.collection('renderJobs').doc(jobId);
    const updateData = { status, message, updatedAt: new Date() };
    if (progress !== null) {
        updateData.progress = progress;
    }
    await jobRef.set(updateData, { merge: true });
    console.log(`[${jobId}] 상태: ${status} - ${message} (${progress !== null ? progress + '%' : ''})`);
}

// ▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 worker.js의 renderVideo 함수 전체를 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼

async function renderVideo(jobId) {
    const fps = 30;
    const tempDir = path.join(os.tmpdir(), jobId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.aac');
    const outputVideoPath = path.join(tempDir, 'output.mp4');
    
    let projectData;
    let browser;

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);

        await updateJobStatus(jobId, 'processing', '작업 데이터 다운로드 중...', 5);
        const bucket = storage.bucket(JOB_DATA_BUCKET_NAME);
        const file = bucket.file(`${jobId}.json`);
        const [data] = await file.download();
        projectData = JSON.parse(data.toString());
        await file.delete();

        await updateJobStatus(jobId, 'processing', '영상 프레임 생성 중...', 10);
        browser = await playwright.chromium.launch();
        const context = await browser.newContext({ bypassCSP: true });
        const page = await context.newPage();
        await page.setViewportSize({ width: 1080, height: 1920 });
        
        const renderTemplatePath = `file://${path.join(__dirname, 'render_template.html')}`;
        await page.goto(renderTemplatePath, { waitUntil: 'networkidle' });
        
        let frameCount = 0;
        const totalFrames = projectData.scriptCards.reduce((sum, card) => sum + Math.floor(card.duration * fps), 0);
        let currentPersistentMedia = null;

        for (const card of projectData.scriptCards) {
            if (card.media.url && card.media.persistUntilCardId) {
                currentPersistentMedia = { media: card.media, layout: card.layout.media, animations: card.animations.media, endCardId: card.media.persistUntilCardId };
            }
            const mediaToRender = currentPersistentMedia ? currentPersistentMedia : { media: card.media, layout: card.layout.media, animations: card.animations.media };
            const cardFrames = Math.floor(card.duration * fps);

            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                await page.evaluate(async (args) => {
                    const { project, currentCard, mediaInfo, t } = args;
                    const scale = 1080 / (project.renderMetadata.sourceWidth || 420);
                    const pSettings = project.projectSettings;

                    // --- 헬퍼 함수 (클라이언트 로직 100% 이식) ---
                    const applyTransform = (el, layout) => {
                        if (el && layout) el.style.transform = `translate(${layout.x * scale}px, ${layout.y * scale}px) scale(${layout.scale || 1}) rotate(${layout.angle || 0}deg)`;
                    };
                    const applyAnimation = (el, anims, duration, time) => {
                        if (!el || !anims) return;
                        el.style.opacity = '1';
                        const baseTransform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY') && !s.startsWith('scale')).join(' ');
                        let progress, newTransform = '', opacity = 1;
                        const inDuration = anims.in.duration;
                        const outStartTime = duration - anims.out.duration;
                        if (time < inDuration && anims.in.name !== 'none') {
                            progress = Math.min(1, time / inDuration);
                            if (anims.in.name === 'fadeIn') opacity = progress;
                            else if (anims.in.name === 'slideInUp') newTransform = ` translateY(${(1 - progress) * 50 * scale}px)`;
                            else if (anims.in.name === 'zoomIn') { opacity = progress; newTransform = ` scale(${0.8 + 0.2 * progress})`; }
                        } else if (time >= outStartTime && anims.out.name !== 'none') {
                            progress = Math.min(1, (time - outStartTime) / anims.out.duration);
                            if (anims.out.name === 'fadeOut') opacity = 1 - progress;
                            else if (anims.out.name === 'slideOutDown') newTransform = ` translateY(${progress * 50 * scale}px)`;
                            else if (anims.out.name === 'zoomOut') { opacity = 1 - progress; newTransform = ` scale(${1 - 0.2 * progress})`; }
                        }
                        el.style.opacity = opacity;
                        el.style.transform = `${baseTransform} ${newTransform}`;
                    };

                    // --- DOM 요소 선택 ---
                    const headerEl = document.querySelector('.st-preview-header'), headerTitleEl = headerEl.querySelector('.header-title'), headerLogoEl = document.getElementById('header-logo');
                    const projectInfoEl = document.querySelector('.st-project-info'), projectInfoTitleEl = projectInfoEl.querySelector('.title'), projectInfoSpanEl = projectInfoEl.querySelector('span');
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper'), textEl = document.querySelector('#st-preview-text');
                    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper'), imageEl = document.querySelector('#st-preview-image'), videoEl = document.querySelector('#st-preview-video');

                    // --- 스타일 및 내용 적용 (모든 기능 포함) ---
                    headerEl.style.height = `${65 * scale}px`; headerEl.style.padding = `0 ${15 * scale}px`;
                    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                    headerTitleEl.innerText = pSettings.header.text; headerTitleEl.style.color = pSettings.header.color; headerTitleEl.style.fontFamily = pSettings.header.fontFamily; headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
                    if (pSettings.header.logo.url) {
                        if(headerLogoEl.src !== pSettings.header.logo.url) headerLogoEl.src = pSettings.header.logo.url;
                        headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.display = 'block';
                    } else { headerLogoEl.style.display = 'none'; }
                    
                    projectInfoEl.style.padding = `${10 * scale}px`; projectInfoEl.style.paddingBottom = `${16 * scale}px`; projectInfoEl.style.marginBottom = `${16 * scale}px`;
                    projectInfoTitleEl.innerText = pSettings.project.title; projectInfoTitleEl.style.color = pSettings.project.titleColor; projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily; projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`;
                    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`; projectInfoSpanEl.style.color = pSettings.project.metaColor; projectInfoSpanEl.style.fontSize = `${13 * scale}px`;
                    
                    const scaledStyle = { ...currentCard.style }; scaledStyle.fontSize = `${parseFloat(currentCard.style.fontSize) * scale}px`; scaledStyle.letterSpacing = `${parseFloat(currentCard.style.letterSpacing) * scale}px`; Object.assign(textEl.style, scaledStyle);
                    
                    applyTransform(textWrapper, currentCard.layout.text);
                    textEl.innerHTML = '';
                    if (currentCard.measuredLines) {
                        currentCard.measuredLines.forEach(line => {
                            const p = document.createElement('div');
                            Object.assign(p.style, scaledStyle); p.style.position = 'absolute';
                            p.style.left = `${line.x * scale}px`; p.style.top = `${line.y * scale}px`; p.style.whiteSpace = 'nowrap';
                            p.textContent = line.text; textEl.appendChild(p);
                        });
                    }
                    
                    let showMedia = false;
                    if (mediaInfo.media && mediaInfo.media.url) {
                         const showOnSegmentIndex = (mediaInfo.media.showOnSegment || 1) - 1;
                         const showTime = (currentCard.segments && currentCard.segments[showOnSegmentIndex]) ? currentCard.segments[showOnSegmentIndex].startTime : 0;
                         if (t >= showTime) showMedia = true;
                    }
                    mediaWrapper.style.display = 'none';
                    if (showMedia) {
                        mediaWrapper.style.display = 'flex'; applyTransform(mediaWrapper, mediaInfo.layout);
                        if (mediaInfo.media.type === 'video') {
                            imageEl.style.display = 'none'; videoEl.style.display = 'block'; videoEl.style.objectFit = mediaInfo.media.fit;
                            if (videoEl.src !== mediaInfo.media.url) videoEl.src = mediaInfo.media.url;
                            videoEl.currentTime = (mediaInfo.media.startTime || 0) + t;
                        } else {
                            videoEl.style.display = 'none'; imageEl.style.display = 'block'; imageEl.style.objectFit = mediaInfo.media.fit;
                            if (imageEl.src !== mediaInfo.media.url) imageEl.src = mediaInfo.media.url;
                        }
                    }
                    applyAnimation(textWrapper, currentCard.animations.text, currentCard.duration, t);
                    if(showMedia) applyAnimation(mediaWrapper, mediaInfo.animations, currentCard.duration, t);
                }, { project: projectData, currentCard: card, mediaInfo: mediaToRender, t: timeInCard });
                
                await page.evaluate(async () => {
                    const media = Array.from(document.querySelectorAll('img, video'));
                    const promises = media.map(m => {
                        if (m.tagName === 'IMG' && m.src && !m.complete) return new Promise(r => { m.onload = m.onerror = r; });
                        if (m.tagName === 'VIDEO' && m.src && m.readyState < 3) return new Promise(r => { m.oncanplaythrough = m.onerror = r; });
                        return Promise.resolve();
                    });
                    await Promise.all(promises);
                });

                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                const progress = 10 + Math.floor((frameCount / totalFrames) * 45);
                 if (frameCount % 10 === 0 || frameCount === totalFrames - 1) {
                    await updateJobStatus(jobId, 'processing', `프레임 생성 중... (${frameCount + 1}/${totalFrames})`, progress);
                }
                frameCount++;
            }
             if (currentPersistentMedia && currentPersistentMedia.endCardId === card.id) {
                currentPersistentMedia = null;
            }
        }
        await browser.close();
        
        await updateJobStatus(jobId, 'processing', '오디오 트랙 처리 중...', 60);
        const audioTracks = (projectData.scriptCards || []).map((card, index) => ({ startTime: (projectData.scriptCards || []).slice(0, index).reduce((acc, c) => acc + c.duration, 0), tts: card.audioUrl ? { url: card.audioUrl, volume: card.ttsVolume } : null, sfx: card.sfxUrl ? { url: card.sfxUrl, volume: card.sfxVolume } : null }));
        const audioInputs = []; let complexFilter = ''; const audioStreamsToMix = [];
        if (projectData.globalBGM && projectData.globalBGM.url) {
            const bgmPath = path.join(audioDir, `bgm.mp3`);
            if(projectData.globalBGM.url.startsWith('data:')){
                const base64Data = projectData.globalBGM.url.split(',')[1];
                await fs.writeFile(bgmPath, Buffer.from(base64Data, 'base64'));
                audioInputs.push(`-i "${bgmPath}"`);
                const totalDuration = totalFrames / fps;
                complexFilter += `[${audioStreamsToMix.length}:a]aloop=loop=-1:size=2e+09,atrim=start=${projectData.globalBGM.startTime || 0}:duration=${totalDuration},volume=${projectData.globalBGM.volume || 0.3}[bgm];`;
                audioStreamsToMix.push('[bgm]');
            }
        }
        for (const [index, track] of audioTracks.entries()) {
            if (track.tts && track.tts.url) {
                const ttsPath = path.join(audioDir, `tts_${index}.mp3`);
                const base64Data = track.tts.url.split(',')[1];
                await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64'));
                audioInputs.push(`-i "${ttsPath}"`);
                complexFilter += `[${audioStreamsToMix.length}:a]adelay=${track.startTime * 1000}|${track.startTime * 1000},volume=${track.tts.volume || 0.9}[tts${index}];`;
                audioStreamsToMix.push(`[tts${index}]`);
            }
            if (track.sfx && track.sfx.url) {
                const sfxPath = path.join(audioDir, `sfx_${index}.mp3`);
                if(track.sfx.url.startsWith('data:')){
                    const base64Data = track.sfx.url.split(',')[1];
                    await fs.writeFile(sfxPath, Buffer.from(base64Data, 'base64'));
                    audioInputs.push(`-i "${sfxPath}"`);
                    complexFilter += `[${audioStreamsToMix.length}:a]adelay=${track.startTime * 1000}|${track.startTime * 1000},volume=${track.sfx.volume || 0.8}[sfx${index}];`;
                    audioStreamsToMix.push(`[sfx${index}]`);
                }
            }
        }
        if (audioStreamsToMix.length > 0) {
            const mixInputs = audioStreamsToMix.join('');
            complexFilter += `${mixInputs}amix=inputs=${audioStreamsToMix.length}:duration=longest[final_audio]`;
            const mixCommand = `ffmpeg ${audioInputs.join(' ')} -filter_complex "${complexFilter}" -map "[final_audio]" -y "${finalAudioPath}"`;
            await new Promise((resolve, reject) => exec(mixCommand, (err) => {
                if (err) return reject(new Error(`오디오 믹싱 오류: ${err.message}`));
                resolve();
            }));
        }

        await updateJobStatus(jobId, 'processing', '최종 영상 합성 중...', 80);
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -vf "scale=1080:1920,setsar=1:1,format=yuv420p" -c:a aac -b:a 192k -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err) => {
            if (err) return reject(new Error(`FFMPEG 최종 합성 오류: ${err.message}`));
            resolve();
        }));

        await updateJobStatus(jobId, 'processing', '영상 업로드 중...', 95);
        const videoTitle = projectData.projectSettings?.project?.title || 'sunsak-video';
        const safeTitle = videoTitle.replace(/[^a-zA-Z0-9-_\.]/g, '_');
        const destination = `videos/${jobId}/${safeTitle}.mp4`;
        await storage.bucket(OUTPUT_BUCKET_NAME).upload(outputVideoPath, { destination, contentType: 'video/mp4' });
        const videoUrl = `https://storage.googleapis.com/${OUTPUT_BUCKET_NAME}/${destination}`;
        
        await updateJobStatus(jobId, 'completed', '영상 제작이 완료되었습니다.', 100);
        await firestore.collection('renderJobs').doc(jobId).set({ videoUrl, completedAt: new Date() }, { merge: true });

    } catch (error) {
        if (browser) await browser.close();
        console.error(`[${jobId}] 렌더링 워커 오류:`, error.stack);
        await updateJobStatus(jobId, 'failed', `치명적 오류: ${error.message}`);
    } finally {
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        console.log(`[${jobId}] 임시 파일 정리 완료`);
    }
}


// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
async function listenForMessages() {
    const subscription = pubSubClient.subscription(SUBSCRIPTION_NAME);
    const messageHandler = async (message) => {
        let jobId;
        try {
            const payload = JSON.parse(message.data);
            jobId = payload.jobId;
            if (!jobId) throw new Error('메시지에 jobId가 없습니다.');
            await renderVideo(jobId);
            message.ack();
        } catch (error) {
            console.error(`[${jobId || 'Unknown Job'}] 메시지 처리 오류:`, error.stack);
            if(jobId) await updateJobStatus(jobId, 'failed', `메시지 처리 실패: ${error.message}`);
            message.ack();
        }
    };
    subscription.on('message', messageHandler);
    subscription.on('error', (error) => console.error(`[Pub/Sub] 리스너 오류:`, error));
    console.log(`Pub/Sub 구독(${SUBSCRIPTION_NAME}) 수신 대기 중...`);
}

const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.status(200).send('SunsakTool Worker is alive.'));
app.listen(PORT, () => {
  console.log(`워커 Health Check 서버 ${PORT} 포트에서 실행 중.`);
  listenForMessages();
});

// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
