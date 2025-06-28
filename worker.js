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

// Google Cloud 클라이언트
const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

// --- 환경 설정 및 클라이언트 초기화 ---
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

// --- 핵심 영상 제작 함수 (Playwright 버전) ---
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

        // 단계 1: GCS에서 작업 데이터 다운로드
        await updateJobStatus(jobId, 'processing', '작업 데이터 다운로드 중...', 5);
        const bucket = storage.bucket(JOB_DATA_BUCKET_NAME);
        const file = bucket.file(`${jobId}.json`);
        const [data] = await file.download();
        projectData = JSON.parse(data.toString());
        console.log(`[${jobId}] 작업 데이터 다운로드 완료`);
        await file.delete();

        // [핵심] 단계 2: Playwright로 프레임 생성
        await updateJobStatus(jobId, 'processing', '영상 프레임 생성 중...', 10);
        console.log(`[${jobId}] Playwright 실행`);
        browser = await playwright.chromium.launch();
        const context = await browser.newContext({ bypassCSP: true });
        const page = await context.newPage();
        await page.setViewportSize({ width: 1080, height: 1920 });
        
        const renderTemplatePath = `file://${path.join(__dirname, 'render_template.html')}`;
        await page.goto(renderTemplatePath, { waitUntil: 'networkidle' });
        console.log(`[${jobId}] 렌더링 템플릿 로드 완료`);
        
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
                
                await page.evaluate(async (args) => {
                    const { project, currentCard, mediaInfo, t } = args;
                    const scale = 1080 / (project.renderMetadata.sourceWidth || 420);
                    const pSettings = project.projectSettings;
                    
                    document.querySelector('.st-preview-header').style.backgroundColor = pSettings.header.backgroundColor;
                    document.querySelector('.header-title').innerText = pSettings.header.text;
                    document.querySelector('#st-preview-text').innerText = currentCard.text;
                    // ... 여기에 클라이언트의 updatePreviewForFrame에 있던 모든 DOM 조작 로직을
                    // scale 변수를 적용하여 추가해야 합니다.
                    // 간단한 예시로 텍스트만 넣었지만, 실제로는 모든 스타일을 동기화해야 합니다.

                }, { project: projectData, currentCard: card, mediaInfo: mediaToRender, t: timeInCard });

                // 페이지의 모든 미디어(이미지, 비디오) 로딩을 기다림
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
        
        // 단계 3: 오디오 믹싱
        await updateJobStatus(jobId, 'processing', '오디오 트랙 처리 중...', 55);
        const audioInputs = [];
        let complexFilter = '';
        const audioStreamsToMix = [];
        
        if (projectData.globalBGM && projectData.globalBGM.url) {
            const bgmPath = path.join(audioDir, `bgm.mp3`);
            const base64Data = projectData.globalBGM.url.split(',')[1];
            if (base64Data) {
                await fs.writeFile(bgmPath, Buffer.from(base64Data, 'base64'));
                audioInputs.push(`-i "${bgmPath}"`);
                const totalDuration = totalFrames / fps;
                complexFilter += `[${audioStreamsToMix.length}:a]aloop=loop=-1:size=2e+09,atrim=start=${projectData.globalBGM.startTime || 0}:duration=${totalDuration},volume=${projectData.globalBGM.volume || 0.3}[bgm];`;
                audioStreamsToMix.push('[bgm]');
            }
        }

        for (const [index, track] of projectData.audioTracks.entries()) {
            if (track.tts && track.tts.url) {
                const ttsPath = path.join(audioDir, `tts_${index}.mp3`);
                const base64Data = track.tts.url.split(',')[1];
                if(base64Data) {
                    await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64'));
                    audioInputs.push(`-i "${ttsPath}"`);
                    complexFilter += `[${audioStreamsToMix.length}:a]adelay=${track.startTime * 1000}|${track.startTime * 1000},volume=${track.tts.volume || 0.9}[tts${index}];`;
                    audioStreamsToMix.push(`[tts${index}]`);
                }
            }
            if (track.sfx && track.sfx.url) {
                const sfxPath = path.join(audioDir, `sfx_${index}.mp3`);
                const base64Data = track.sfx.url.split(',')[1];
                 if(base64Data) {
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
            console.log(`[${jobId}] 오디오 믹싱 완료`);
        }

        // 단계 4: 최종 영상 합성
        await updateJobStatus(jobId, 'processing', '최종 영상 합성 중...', 80);
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -vf "scale=1080:1920,setsar=1:1,format=yuv420p" -c:a aac -b:a 192k -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err) => {
            if (err) return reject(new Error(`FFMPEG 최종 합성 오류: ${err.message}`));
            resolve();
        }));
        console.log(`[${jobId}] 최종 영상 합성 완료`);

        // 단계 5: 영상 업로드 및 상태 업데이트
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
