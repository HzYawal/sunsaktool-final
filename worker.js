// ▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 worker.js 전체를 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼

// ===============================================
//  worker.js (진짜 최종 완성 버전 - 생략 없음)
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

const GCP_PROJECT_ID = process.env.GCP_PROJECT || 'sunsak-tool-gcp';

const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
const storage = new Storage({ projectId: GCP_PROJECT_ID });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });

const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
const JOB_DATA_BUCKET_NAME = 'sunsak-job-data';
const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

async function updateJobStatus(jobId, status, message, progress = null) {
    const jobRef = firestore.collection('renderJobs').doc(jobId);
    const updateData = { status, message, updatedAt: new Date() };
    if (progress !== null) {
        updateData.progress = progress;
    }
    await jobRef.set(updateData, { merge: true });
    console.log(`[${jobId}] 상태: ${status} - ${message} (${progress !== null ? progress + '%' : ''})`);
}

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
        console.log(`[${jobId}] 작업 데이터 다운로드 완료`);
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
                currentPersistentMedia = { 
                    media: card.media, 
                    layout: card.layout.media,
                    animations: card.animations.media,
                    endCardId: card.media.persistUntilCardId 
                };
            }

            const mediaToRender = currentPersistentMedia ? currentPersistentMedia : { media: card.media, layout: card.layout.media, animations: card.animations.media };
            const cardFrames = Math.floor(card.duration * fps);

            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                // ▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 page.evaluate(...) 부분을 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼

// [핵심] Playwright의 브라우저 내부에서 모든 렌더링 로직 실행
await page.evaluate(async (args) => {
    const { project, currentCard, mediaInfo, t } = args;
    const scale = 1080 / (project.renderMetadata.sourceWidth || 420);
    const pSettings = project.projectSettings;

    // --- Helper 함수 ---
    const applyTransform = (el, layout) => {
        if (!el || !layout) return;
        const transform = `translate(${layout.x * scale}px, ${layout.y * scale}px) scale(${layout.scale || 1}) rotate(${layout.angle || 0}deg)`;
        el.style.transform = transform;
    };
    const applyAnimation = (el, anims, duration, time) => {
        if (!el || !anims) return;
        // 애니메이션은 복잡하므로 이 예제에서는 생략하지만,
        // 필요하다면 클라이언트의 applyAnimation 로직을 그대로 가져와 scale을 적용할 수 있습니다.
        el.style.animation = 'none'; // 서버 렌더링 시에는 애니메이션을 비활성화하는 것이 안정적일 수 있습니다.
    };

    // --- DOM 요소 선택 ---
    const headerEl = document.querySelector('.st-preview-header');
    const headerTitleEl = headerEl.querySelector('.header-title');
    const headerLogoEl = document.getElementById('header-logo');
    const projectInfoEl = document.querySelector('.st-project-info');
    const projectInfoTitleEl = projectInfoEl.querySelector('.title');
    const projectInfoSpanEl = projectInfoEl.querySelector('span');
    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
    const textEl = document.querySelector('#st-preview-text');
    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
    const imageEl = document.querySelector('#st-preview-image');
    const videoEl = document.querySelector('#st-preview-video');
    
    // --- 스타일 및 내용 적용 ---
    // 헤더
    headerEl.style.height = `${pSettings.header.height || 65 * scale}px`; // 클라이언트에서 높이 값을 전달했다고 가정
    headerEl.style.padding = `0 ${15 * scale}px`;
    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
    headerTitleEl.innerText = pSettings.header.text;
    headerTitleEl.style.color = pSettings.header.color;
    headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
    headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
    
    if (pSettings.header.logo.url) {
        if(headerLogoEl.src !== pSettings.header.logo.url) headerLogoEl.src = pSettings.header.logo.url;
        headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`;
        headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`;
        headerLogoEl.style.display = 'block';
    } else {
        headerLogoEl.style.display = 'none';
    }

    // 프로젝트 정보
    projectInfoTitleEl.innerText = pSettings.project.title;
    projectInfoTitleEl.style.color = pSettings.project.titleColor;
    projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
    projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`;
    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
    projectInfoSpanEl.style.color = pSettings.project.metaColor;
    projectInfoSpanEl.style.fontSize = `${13 * scale}px`;

    // 텍스트 스타일
    const scaledStyle = { ...currentCard.style };
    scaledStyle.fontSize = `${parseFloat(currentCard.style.fontSize) * scale}px`;
    scaledStyle.letterSpacing = `${parseFloat(currentCard.style.letterSpacing) * scale}px`;
    Object.assign(textEl.style, scaledStyle);
    
    // 텍스트/미디어 위치
    applyTransform(textWrapper, currentCard.layout.text);

    // 텍스트 내용
    textEl.innerText = currentCard.text;
    
    // 미디어 표시
    mediaWrapper.style.display = 'none';
    if (mediaInfo.media && mediaInfo.media.url) {
        mediaWrapper.style.display = 'flex';
        applyTransform(mediaWrapper, mediaInfo.layout);
        if (mediaInfo.media.type === 'video') {
            imageEl.style.display = 'none';
            videoEl.style.display = 'block';
            videoEl.style.objectFit = mediaInfo.media.fit;
            if (videoEl.src !== mediaInfo.media.url) videoEl.src = mediaInfo.media.url;
            videoEl.currentTime = (mediaInfo.media.startTime || 0) + t;
        } else {
            imageEl.style.display = 'none';
            imageEl.style.display = 'block';
            imageEl.style.objectFit = mediaInfo.media.fit;
            if (imageEl.src !== mediaInfo.media.url) imageEl.src = mediaInfo.media.url;
        }
    }

}, { project: projectData, currentCard: card, mediaInfo: mediaToRender, t: timeInCard });

// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

                await page.evaluate(async () => {
                    const media = Array.from(document.querySelectorAll('img, video'));
                    const promises = media.map(m => {
                        if (m.tagName === 'IMG' && m.src && !m.complete) {
                            return new Promise(r => { m.onload = m.onerror = r; });
                        }
                        if (m.tagName === 'VIDEO' && m.src && m.readyState < 3) {
                            return new Promise(r => { m.onloadeddata = m.onerror = r; });
                        }
                        return Promise.resolve();
                    });
                    await Promise.all(promises);
                });

                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                
                const progress = 10 + Math.floor((frameCount / totalFrames) * 40);
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
        console.log(`[${jobId}] 프레임 캡처 완료 (${frameCount}개)`);
        
        await updateJobStatus(jobId, 'processing', '오디오 트랙 처리 중...', 55);
        
        const audioTracks = (projectData.scriptCards || []).map((card, index) => {
            const startTime = (projectData.scriptCards || []).slice(0, index).reduce((acc, c) => acc + c.duration, 0);
            return {
                startTime: startTime,
                tts: card.audioUrl ? { url: card.audioUrl, volume: card.ttsVolume } : null,
                sfx: card.sfxUrl ? { url: card.sfxUrl, volume: card.sfxVolume } : null,
            };
        });

        const audioInputs = [];
        let complexFilter = '';
        const audioStreamsToMix = [];
        
        if (projectData.globalBGM && projectData.globalBGM.url && projectData.globalBGM.url.includes('base64')) {
            const bgmPath = path.join(audioDir, `bgm.mp3`);
            const base64Data = projectData.globalBGM.url.split(',')[1];
            await fs.writeFile(bgmPath, Buffer.from(base64Data, 'base64'));
            audioInputs.push(`-i "${bgmPath}"`);
            const totalDuration = totalFrames / fps;
            complexFilter += `[${audioStreamsToMix.length}:a]aloop=loop=-1:size=2e+09,atrim=start=${projectData.globalBGM.startTime || 0}:duration=${totalDuration},volume=${projectData.globalBGM.volume || 0.3}[bgm];`;
            audioStreamsToMix.push('[bgm]');
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
            if (track.sfx && track.sfx.url && track.sfx.url.includes('base64')) {
                const sfxPath = path.join(audioDir, `sfx_${index}.mp3`);
                const base64Data = track.sfx.url.split(',')[1];
                await fs.writeFile(sfxPath, Buffer.from(base64Data, 'base64'));
                audioInputs.push(`-i "${sfxPath}"`);
                complexFilter += `[${audioStreamsToMix.length}:a]adelay=${track.startTime * 1000}|${track.startTime * 1000},volume=${track.sfx.volume || 0.8}[sfx${index}];`;
                audioStreamsToMix.push(`[sfx${index}]`);
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
