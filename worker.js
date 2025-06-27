// ================== [worker.js - 렌더링 워커 서비스 전체 코드] ==================
const express = require('express'); // express 추가
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const os = require('os');
const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

// --- Google Cloud 서비스 클라이언트 초기화 ---
const pubSubClient = new PubSub();
const storage = new Storage();
const firestore = new Firestore();

// --- 환경 설정 ---
// 이 값들은 server.js와 동일해야 합니다.
const RENDER_TOPIC_NAME = 'sunsak-render-jobs';
const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
// 워커가 구독할 '구독'의 이름입니다. GCP 콘솔에서 Pub/Sub 토픽에 연결된 구독을 생성해야 합니다.
const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

/**
 * Firestore의 작업 상태를 업데이트하는 헬퍼 함수
 * @param {string} jobId - 작업 ID
 * @param {string} status - 현재 상태 ('processing', 'completed', 'failed')
 * @param {string} message - 사용자에게 보여줄 메시지
 * @param {number|null} progress - 진행률 (0-100)
 */
async function updateJobStatus(jobId, status, message, progress = null) {
    const jobRef = firestore.collection('renderJobs').doc(jobId);
    const updateData = { status, message, updatedAt: new Date() };
    if (progress !== null) {
        updateData.progress = progress;
    }
    // set-merge를 사용하여 필드가 없으면 생성하고, 있으면 덮어씁니다.
    await jobRef.set(updateData, { merge: true });
    console.log(`[${jobId}] 상태 업데이트: ${status} - ${message} (${progress !== null ? progress + '%' : ''})`);
}

/**
 * 실제 영상 렌더링을 수행하는 메인 함수
 * @param {string} jobId - 작업 ID
 * @param {object} projectData - 프론트에서 받은 렌더링 데이터
 */
async function renderVideo(jobId, projectData) {
    // 여기부터는 대표님의 기존 /render-video 로직과 거의 동일합니다.
    await updateJobStatus(jobId, 'processing', '렌더링 환경을 설정하고 있습니다.', 5);
    const fps = 30;
    const tempDir = path.join(os.tmpdir(), jobId); // renderId 대신 jobId 사용
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.mp3');
    const outputVideoPath = path.join(tempDir, 'output.mp4');
    let browser;

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);
        
        // --- 1. Puppeteer로 비디오 프레임 캡처 ---
        await updateJobStatus(jobId, 'processing', '비디오 프레임 캡처를 시작합니다.', 10);
        
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1080, height: 1920 });
        
        // render_template.html 파일은 worker.js와 같은 위치에 있어야 합니다.
        const renderTemplateContent = await fs.readFile(path.join(__dirname, 'render_template.html'), 'utf-8');
        await page.setContent(renderTemplateContent, { waitUntil: 'networkidle0' });

        await page.evaluate(async () => {
            const fontPromises = Array.from(document.fonts).map(font => font.load());
            await Promise.all(fontPromises);
        });
        
        let frameCount = 0;
        let currentPersistentMedia = null;
        const totalFramesToRender = projectData.scriptCards.reduce((sum, card) => sum + Math.floor(card.duration * fps), 0);

        for (const [cardIndex, card] of projectData.scriptCards.entries()) {
            if (card.media.url && card.media.persistUntilCardId) {
                currentPersistentMedia = { media: card.media, layout: card.layout.media, animations: card.animations.media, endCardId: card.media.persistUntilCardId };
            }

            const mediaToRender = currentPersistentMedia ? currentPersistentMedia : { media: card.media, layout: card.layout.media, animations: card.animations.media };
            const cardFrames = Math.floor(card.duration * fps);

            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                await page.evaluate((project, currentCard, mediaInfo, t) => {
                    const scale = 1080 / project.renderMetadata.sourceWidth;
                    const pSettings = project.projectSettings;
                    
                    // (이하 page.evaluate 내용은 대표님의 기존 코드와 100% 동일)
                    const headerEl = document.querySelector('.st-preview-header');
                    const headerTitleEl = headerEl.querySelector('.header-title');
                    const headerIconEl = headerEl.querySelector('.header-icon');
                    const headerLogoEl = headerEl.querySelector('.header-logo');
                    headerEl.style.height = `${65 * scale}px`;
                    headerEl.style.padding = `0 ${15 * scale}px`;
                    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                    headerTitleEl.innerText = pSettings.header.text;
                    headerTitleEl.style.color = pSettings.header.color;
                    headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                    headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
                    const iconSVG = {
                        back: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
                        menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`
                    };
                    headerIconEl.innerHTML = iconSVG[pSettings.header.icon] || '';
                    if (pSettings.header.logo.url) {
                        headerLogoEl.src = pSettings.header.logo.url;
                        headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`;
                        headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`;
                        headerLogoEl.style.display = 'block';
                    } else {
                        headerLogoEl.style.display = 'none';
                    }
                    const projectInfoEl = document.querySelector('.st-project-info');
                    projectInfoEl.style.paddingBottom = `${16 * scale}px`;
                    projectInfoEl.style.marginBottom = `${16 * scale}px`;
                    const projectInfoTitleEl = projectInfoEl.querySelector('.title');
                    projectInfoTitleEl.innerText = pSettings.project.title;
                    projectInfoTitleEl.style.color = pSettings.project.titleColor;
                    projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                    projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`;
                    projectInfoTitleEl.style.marginBottom = `${5 * scale}px`;
                    const projectInfoSpanEl = projectInfoEl.querySelector('span');
                    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                    projectInfoSpanEl.style.color = pSettings.project.metaColor;
                    projectInfoSpanEl.style.fontSize = `${13 * scale}px`;
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                    const textEl = document.querySelector('#st-preview-text');
                    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                    const imageEl = document.querySelector('#st-preview-image');
                    const videoEl = document.querySelector('#st-preview-video');
                    const scaledStyle = { ...currentCard.style };
                    scaledStyle.fontSize = `${parseFloat(currentCard.style.fontSize) * scale}px`;
                    scaledStyle.lineHeight = currentCard.style.lineHeight;
                    scaledStyle.letterSpacing = `${parseFloat(currentCard.style.letterSpacing) * scale}px`;
                    Object.assign(textEl.style, scaledStyle);
                    textWrapper.style.transform = `translate(${currentCard.layout.text.x * scale}px, ${currentCard.layout.text.y * scale}px) scale(${currentCard.layout.text.scale || 1}) rotate(${currentCard.layout.text.angle || 0}deg)`;
                    let showMedia = false;
                    if(mediaInfo.media && mediaInfo.media.url) {
                        const showOnSegmentIndex = mediaInfo.media.showOnSegment - 1;
                        const showTime = (currentCard.segments[showOnSegmentIndex] || {startTime: 0}).startTime;
                        if (t >= showTime) showMedia = true;
                    }
                    if(showMedia) {
                        mediaWrapper.style.display = 'flex';
                        mediaWrapper.style.transform = `translate(${mediaInfo.layout.x * scale}px, ${mediaInfo.layout.y * scale}px) scale(${mediaInfo.layout.scale || 1}) rotate(${mediaInfo.layout.angle || 0}deg)`;
                        if (mediaInfo.media.type === 'video') {
                            imageEl.style.display = 'none';
                            videoEl.style.display = 'block';
                            videoEl.style.objectFit = mediaInfo.media.fit;
                            if (videoEl.src !== mediaInfo.media.url) videoEl.src = mediaInfo.media.url;
                            videoEl.currentTime = (mediaInfo.media.startTime || 0) + t;
                        } else {
                            videoEl.style.display = 'none';
                            imageEl.style.display = 'block';
                            imageEl.style.objectFit = mediaInfo.media.fit;
                            if (imageEl.src !== mediaInfo.media.url) imageEl.src = mediaInfo.media.url;
                        }
                    } else {
                        mediaWrapper.style.display = 'none';
                    }
                    textEl.innerHTML = '';
                    const hasCustomSequence = currentCard.animationSequence && currentCard.animationSequence.length > 0;
                    if (hasCustomSequence) {
                        (currentCard.segments || []).forEach(segment => {
                            if (t >= segment.startTime) {
                                const p = document.createElement('p');
                                p.textContent = segment.text || ' ';
                                p.style.margin = 0;
                                textEl.appendChild(p);
                            }
                        });
                    } else {
                        currentCard.text.split('\n').forEach(line => {
                            const p = document.createElement('p');
                            p.textContent = line || ' ';
                            p.style.margin = 0;
                            textEl.appendChild(p);
                        });
                    }
                    const applyAnimation = (el, anims, duration, time) => {
                        const baseTransform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY') && !s.startsWith('scale')).join(' ');
                        el.style.opacity = 1;
                        el.style.transform = baseTransform;
                        const inDuration = anims.in.duration;
                        const outStartTime = duration - anims.out.duration;
                        let progress, newTransform = '';
                        if (time < inDuration && anims.in.name !== 'none') {
                            progress = Math.min(1, time / inDuration);
                            if(anims.in.name === 'fadeIn') el.style.opacity = progress;
                            if(anims.in.name === 'slideInUp') newTransform = ` translateY(${(1 - progress) * 50 * scale}px)`;
                            if(anims.in.name === 'zoomIn') { el.style.opacity = progress; newTransform = ` scale(${0.8 + 0.2 * progress})`; }
                        } else if (time >= outStartTime && anims.out.name !== 'none') {
                            progress = Math.min(1, (time - outStartTime) / anims.out.duration);
                            if(anims.out.name === 'fadeOut') el.style.opacity = 1 - progress;
                            if(anims.out.name === 'slideOutDown') newTransform = ` translateY(${progress * 50 * scale}px)`;
                            if(anims.out.name === 'zoomOut') { el.style.opacity = 1 - progress; newTransform = ` scale(${1 - 0.2 * progress})`; }
                        }
                        el.style.transform = `${baseTransform} ${newTransform}`;
                    };
                    applyAnimation(textWrapper, currentCard.animations.text, currentCard.duration, t);
                    if(showMedia) applyAnimation(mediaWrapper, mediaInfo.animations, currentCard.duration, t);
                }, projectData, card, mediaToRender, timeInCard);

                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                frameCount++;

                // 진행률 업데이트 (10% ~ 50% 구간 할당)
                const currentProgress = 10 + Math.floor((frameCount / totalFramesToRender) * 40);
                if(frameCount % 30 === 0) { // 너무 자주 업데이트하지 않도록 조절
                    await updateJobStatus(jobId, 'processing', `${cardIndex + 1}번째 클립 렌더링 중...`, currentProgress);
                }
            }
            if (currentPersistentMedia && currentPersistentMedia.endCardId === card.id) currentPersistentMedia = null;
        }
        await browser.close();
        
        // --- 2. 오디오 트랙 생성 및 믹싱 ---
        await updateJobStatus(jobId, 'processing', '오디오 트랙을 처리하고 있습니다.', 55);
        const audioRenderPromise = (async () => {
            const audioTracks = [];
            let currentTime = 0;
            if (projectData.globalBGM && projectData.globalBGM.url) {
                try { const response = await fetch(projectData.globalBGM.url); const path = `${audioDir}/bgm.mp3`; await fs.writeFile(path, await response.buffer()); audioTracks.push({ type: 'bgm', path, volume: projectData.globalBGM.volume || 0.3 }); } catch (e) { console.error('BGM 다운로드 실패:', e); }
            }
            for (const [index, card] of projectData.scriptCards.entries()) {
                if (card.audioUrl && card.audioUrl.startsWith('data:audio/')) {
                    try { const ttsPath = `${audioDir}/tts_${index}.mp3`; const base64Data = card.audioUrl.split(',')[1]; await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64')); audioTracks.push({ type: 'effect', path: ttsPath, time: currentTime, volume: card.ttsVolume || 1.0 }); } catch (e) { console.error('TTS Base64 파일 저장 실패:', e); }
                }
                if (card.sfxUrl) {
                    try { const response = await fetch(card.sfxUrl); const sfxPath = `${audioDir}/sfx_${index}.mp3`; await fs.writeFile(sfxPath, await response.buffer()); audioTracks.push({ type: 'effect', path: sfxPath, time: currentTime, volume: card.sfxVolume || 1.0 }); } catch (e) { console.error('SFX 다운로드 실패:', e); }
                }
                currentTime += card.duration;
            }
            if (audioTracks.length === 0) return;
            const inputClauses = audioTracks.map(t => `-i "${t.path}"`).join(' ');
            let filterComplex = '';
            if (audioTracks.length > 1) {
                const outputStreams = [];
                audioTracks.forEach((track, i) => { let stream = `[${i}:a]`; if (track.type === 'bgm') { stream += `volume=${track.volume}[a${i}]`; } else { stream += `volume=${track.volume},adelay=${track.time * 1000}|${track.time * 1000}[a${i}]`; } filterComplex += stream; outputStreams.push(`[a${i}]`); if(i < audioTracks.length - 1) filterComplex += ';'; });
                filterComplex += `;${outputStreams.join('')}amix=inputs=${outputStreams.length}:duration=longest`;
            } else { const track = audioTracks[0]; filterComplex = `[0:a]volume=${track.volume}`; }
            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
            await new Promise((resolve, reject) => exec(mixCommand, (error, stdout, stderr) => { if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(new Error(stderr)); } resolve(stdout); }));
        })();
        await audioRenderPromise;

        // --- 3. 비디오와 오디오 최종 합성 ---
        await updateJobStatus(jobId, 'processing', '최종 영상으로 합성하고 있습니다.', 80);
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err, stdout, stderr) => { if (err) { console.error('FFMPEG 최종 합성 오류:', stderr); reject(new Error(stderr)); } else resolve(stdout); }));

        // --- 4. 최종 파일을 Cloud Storage에 업로드 ---
        await updateJobStatus(jobId, 'processing', '완성된 영상을 스토리지에 업로드합니다.', 95);
        const destination = `videos/${jobId}/${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`;
        await storage.bucket(OUTPUT_BUCKET_NAME).upload(outputVideoPath, { destination, public: true });
        const videoUrl = `https://storage.googleapis.com/${OUTPUT_BUCKET_NAME}/${destination}`;
        
        // --- 5. Firestore에 최종 상태와 영상 URL 기록 ---
        await updateJobStatus(jobId, 'completed', '영상 제작이 완료되었습니다.', 100);
        await firestore.collection('renderJobs').doc(jobId).set({ videoUrl, completedAt: new Date() }, { merge: true });
        console.log(`[${jobId}] 작업 완료! 최종 영상 URL: ${videoUrl}`);

    } catch (error) {
        console.error(`[${jobId}] 렌더링 워커 오류 발생:`, error);
        await updateJobStatus(jobId, 'failed', `오류가 발생했습니다: ${error.message}`);
    } finally {
        // --- 6. 임시 파일 정리 ---
        if (browser) await browser.close();
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        console.log(`[${jobId}] 임시 파일 정리를 완료했습니다.`);
    }
}

/**
 * Pub/Sub 구독 리스너를 설정하고 메시지 처리를 시작하는 함수
 */
/**
 * Pub/Sub 구독 리스너를 설정하고 메시지 처리를 시작하는 함수
 */
// =================== [worker.js 하단 최종 수정] ===================

/**
 * Pub/Sub 구독 리스너를 설정하고 메시지 처리를 시작하는 함수 (재시도 로직 추가)
 */
function listenForMessages() {
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
            console.error('[Pub/Sub] 메시지 처리 중 심각한 오류:', error);
            message.ack(); 
        }
    };

    const errorHandler = (error) => {
        console.error(`[Pub/Sub] 심각한 오류 발생: ${error.message}`);
        // "구독을 찾을 수 없음" 오류가 발생하면, 잠시 후 다시 연결을 시도합니다.
        if (error.code === 5) { // 5 = NOT_FOUND
            console.log('구독을 찾지 못했습니다. 10초 후에 다시 시도합니다...');
            setTimeout(() => {
                subscription.removeListener('error', errorHandler); // 기존 리스너 제거
                subscription.on('error', errorHandler); // 새 리스너 등록
            }, 10000);
        }
    };

    subscription.on('message', messageHandler);
    subscription.on('error', errorHandler);

    console.log(`=======================================================`);
    console.log(`  SunsakTool 렌더링 워커가 시작되었습니다.`);
    console.log(`  Pub/Sub 구독(${SUBSCRIPTION_NAME})을 수신 대기합니다...`);
    console.log(`=======================================================`);
}

// ================== [worker.js 하단 수정] ===================

// [신규] Cloud Run의 Health Check를 통과하기 위한 최소한의 웹 서버
const app = express();
const PORT = process.env.PORT || 3000;

// Health Check용 엔드포인트. GET / 요청이 오면 "Worker is alive"라고 응답.
app.get('/', (req, res) => {
  res.status(200).send('SunsakTool Worker is alive and listening for jobs.');
});

// 서버를 시작하고, 시작된 후에 Pub/Sub 리스너를 실행합니다.
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  SunsakTool 렌더링 워커의 Health Check 서버가 ${PORT} 포트에서 실행되었습니다.`);
  console.log(`=======================================================`);
  
  // 웹 서버가 성공적으로 시작된 후에 Pub/Sub 메시지 수신을 시작합니다.
  listenForMessages();
});
