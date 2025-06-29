// ▼▼▼▼▼▼▼▼▼▼▼ 이 코드로 worker.js 전체를 교체하세요 ▼▼▼▼▼▼▼▼▼▼▼

// ===============================================
//  worker.js (Playwright Server-Side Rendering)
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

// --- 핵심 영상 제작 함수 ---
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

        // 단계 1: GCS에서 작업 데이터 다운로드 (재시도 로직 포함)
        await updateJobStatus(jobId, 'processing', '작업 데이터 다운로드 중...', 5);
        const bucket = storage.bucket(JOB_DATA_BUCKET_NAME);
        const file = bucket.file(`${jobId}.json`);
        const maxRetries = 3, retryDelay = 2000;
        let data;
        for (let i = 0; i < maxRetries; i++) {
            try {
                [data] = await file.download();
                break;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
        if (!data) throw new Error('작업 데이터 다운로드 최종 실패');
        projectData = JSON.parse(data.toString());
        await file.delete();

        // [핵심 수정] 확대 비율(Scale Factor) 계산
        const targetWidth = 1080;
        const sourceWidth = projectData.renderMetadata?.sourceWidth || 420;
        const scaleFactor = targetWidth / sourceWidth;

        // 단계 2: Playwright로 프레임 생성
        await updateJobStatus(jobId, 'processing', '영상 프레임 생성 중...', 10);
        browser = await playwright.chromium.launch();
        const context = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
        const page = await context.newPage();
        
        const renderTemplatePath = `file://${path.join(__dirname, 'render_template.html')}`;
        await page.goto(renderTemplatePath, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);

        let frameCount = 0;
        const totalFrames = projectData.scriptCards.reduce((sum, card) => sum + Math.floor(card.duration * fps), 0);

        for (const card of projectData.scriptCards) {
            const cardFrames = Math.floor(card.duration * fps);
            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;

                // [핵심 수정] page.evaluate에 scaleFactor 전달 및 모든 크기 값에 적용
                await page.evaluate(async (args) => {
                    const { project, card, timeInCard, scaleFactor } = args;
                    const pSettings = project.projectSettings;

                    // --- 스케일링 함수 ---
                    const scale = (value) => {
                        if (typeof value === 'string' && value.endsWith('px')) {
                            return parseFloat(value) * scaleFactor + 'px';
                        }
                        return parseFloat(value) * scaleFactor;
                    };

                    // --- 1. 헤더 및 프로젝트 정보 업데이트 (스케일링 적용) ---
                    const headerEl = document.querySelector('.st-preview-header');
                    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                    headerEl.style.color = pSettings.header.color;
                    headerEl.style.fontFamily = pSettings.header.fontFamily;
                    // 헤더 높이도 스케일링
                    headerEl.style.height = scale(65) + 'px'; 
                    document.querySelector('.header-title').innerText = pSettings.header.text;
                    document.querySelector('.header-title').style.fontSize = scale(pSettings.header.fontSize);
                    
                    const logoEl = document.querySelector('.header-logo');
                    if (pSettings.header.logo && pSettings.header.logo.url) {
                        logoEl.src = pSettings.header.logo.url;
                        logoEl.style.width = scale(pSettings.header.logo.size);
                        logoEl.style.height = scale(pSettings.header.logo.size);
                        logoEl.style.display = 'block';
                    } else {
                        logoEl.style.display = 'none';
                    }

                    const projectInfoEl = document.querySelector('.st-project-info');
                    projectInfoEl.style.fontSize = scale(13) + 'px';
                    projectInfoEl.style.marginBottom = scale(16) + 'px';
                    projectInfoEl.style.paddingBottom = scale(16) + 'px';

                    const projectInfoTitleEl = document.querySelector('.st-project-info .title');
                    projectInfoTitleEl.innerText = pSettings.project.title;
                    projectInfoTitleEl.style.color = pSettings.project.titleColor;
                    projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                    projectInfoTitleEl.style.fontSize = scale(pSettings.project.titleFontSize);
                    projectInfoTitleEl.style.marginBottom = scale(5) + 'px';

                    const projectInfoSpanEl = document.querySelector('.st-project-info span');
                    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                    projectInfoSpanEl.style.color = pSettings.project.metaColor;
                    
                    // --- 2. 텍스트 및 미디어 요소 선택 ---
                    const textWrapper = document.getElementById('st-preview-text-container-wrapper');
                    const textEl = document.getElementById('st-preview-text');
                    const mediaWrapper = document.getElementById('st-preview-media-container-wrapper');
                    const imageEl = document.getElementById('st-preview-image');
                    
                    // --- 3. 레이아웃 적용 (Transform 스케일링 적용) ---
                    const applyTransform = (el, layout) => {
                        if (el && layout) {
                            el.style.transform = `translate(${scale(layout.x || 0)}px, ${scale(layout.y || 0)}px) scale(${layout.scale || 1}) rotate(${layout.angle || 0}deg)`;
                        }
                    };
                    applyTransform(textWrapper, card.layout.text);
                    applyTransform(mediaWrapper, card.layout.media);

                    // --- 4. 텍스트 스타일 및 내용 적용 (스케일링 적용) ---
                    const scaledStyle = { ...card.style };
                    scaledStyle.fontSize = scale(card.style.fontSize);
                    scaledStyle.letterSpacing = scale(card.style.letterSpacing);
                    Object.assign(textEl.style, scaledStyle);
                    
                    textEl.innerHTML = '';
                    if (card.segments && card.segments.length > 0) {
                        card.segments.forEach(segment => {
                            if (timeInCard >= segment.startTime) {
                                const p = document.createElement('p');
                                p.className = 'preview-text-segment';
                                p.textContent = segment.text || ' ';
                                textEl.appendChild(p);
                            }
                        });
                    } else {
                        textEl.innerText = card.text;
                    }
                    // --- 5. 미디어 표시 로직 ---
                    let showMedia = false;
                    if (card.media && card.media.url) {
                        // 클라이언트에서는 비디오를 다루지만, 서버에서는 이미지 프레임만 생성하므로 이미지 타입만 고려합니다.
                        // (비디오 오버레이는 FFmpeg에서 처리)
                        if (card.media.type === 'image') {
                           const showOnSegmentIndex = (card.media.showOnSegment || 1) - 1;
                           const showTime = (card.segments && card.segments[showOnSegmentIndex]) ? card.segments[showOnSegmentIndex].startTime : 0;
                           if (timeInCard >= showTime) {
                               showMedia = true;
                           }
                        }
                    }
                    
                    if (showMedia) {
                        mediaWrapper.style.display = 'flex';
                        imageEl.style.display = 'block';
                        imageEl.style.objectFit = card.media.fit;
                        if (imageEl.src !== card.media.url) {
                            imageEl.src = card.media.url;
                        }
                    } else {
                        mediaWrapper.style.display = 'none';
                    }

                    // --- 6. 애니메이션 로직 적용 ---
                    const applyFrameAnimation = (el, anims, duration, time) => {
                        if (!el || !anims) return;
                        
                        // 기존 transform 값에서 애니메이션 부분을 제외하고 유지
                        const baseTransform = el.style.transform.replace(/translateY\([^)]+\)/g, '').replace(/scale\([^)]+\)/g, '').trim();

                        el.style.opacity = '1';
                        let animationTransform = '';

                        const inDuration = anims.in.duration;
                        const outStartTime = duration - anims.out.duration;

                        if (time < inDuration && anims.in.name !== 'none') {
                            const progress = Math.max(0, Math.min(1, time / inDuration));
                            if (anims.in.name === 'fadeIn') el.style.opacity = progress;
                            if (anims.in.name === 'slideInUp') animationTransform += ` translateY(${(1 - progress) * 50}px)`;
                            if (anims.in.name === 'zoomIn') {
                                el.style.opacity = progress;
                                animationTransform += ` scale(${0.8 + 0.2 * progress})`;
                            }
                        } else if (time >= outStartTime && anims.out.name !== 'none') {
                            const progress = Math.max(0, Math.min(1, (time - outStartTime) / anims.out.duration));
                            if (anims.out.name === 'fadeOut') el.style.opacity = 1 - progress;
                            if (anims.out.name === 'slideOutDown') animationTransform += ` translateY(${progress * 50}px)`;
                            if (anims.out.name === 'zoomOut') {
                                el.style.opacity = 1 - progress;
                                animationTransform += ` scale(${1 - 0.2 * progress})`;
                            }
                        }
                        
                        el.style.transform = `${baseTransform} ${animationTransform}`.trim();
                    };

                    applyFrameAnimation(textWrapper, card.animations.text, card.duration, timeInCard);
                    if (showMedia) {
                        applyFrameAnimation(mediaWrapper, card.animations.media, card.duration, timeInCard);
                    }

                }, { project: projectData, card: card, timeInCard: timeInCard });

                await page.screenshot({ path: path.join(framesDir, `frame_${String(frameCount++).padStart(6, '0')}.png`) });
            
                // 진행률 업데이트
                if (frameCount % fps === 0) { // 1초마다 업데이트
                    const progress = 10 + Math.floor((frameCount / totalFrames) * 40);
                    await updateJobStatus(jobId, 'processing', `영상 프레임 생성 중... (${frameCount}/${totalFrames})`, progress);
                }
            }
        }
        await browser.close();
        await updateJobStatus(jobId, 'processing', '프레임 캡처 완료', 50);

        // 단계 3: 오디오 믹싱 (기존 코드와 동일)
        await updateJobStatus(jobId, 'processing', '오디오 트랙 처리 중...', 60);
        // ... (오디오 믹싱 코드는 변경 없음)
        const audioTracks = (projectData.scriptCards || []).map((card, index) => {
            const startTime = (projectData.scriptCards || []).slice(0, index).reduce((acc, c) => acc + c.duration, 0);
            return { startTime, tts: card.audioUrl ? { url: card.audioUrl, volume: card.ttsVolume } : null, sfx: card.sfxUrl ? { url: card.sfxUrl, volume: card.sfxVolume } : null };
        });
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

        // 단계 4: 최종 영상 합성 (기존 코드와 동일)
        await updateJobStatus(jobId, 'processing', '최종 영상 합성 중...', 80);
        // ... (FFmpeg 합성은 변경 없음)
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -vf "scale=1080:1920,setsar=1:1,format=yuv420p" -c:a aac -b:a 192k -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err) => {
            if (err) return reject(new Error(`FFMPEG 최종 합성 오류: ${err.message}`));
            resolve();
        }));


        // 단계 5: 영상 업로드 (기존 코드와 동일)
        await updateJobStatus(jobId, 'processing', '영상 업로드 중...', 95);
        // ... (업로드 로직은 변경 없음)
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

// ... 나머지 worker.js 코드는 기존과 동일합니다 ...
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
            message.ack(); // 실패해도 ack 처리하여 무한 재시도 방지
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
