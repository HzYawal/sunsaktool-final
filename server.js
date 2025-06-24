const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// TTS 중계 API
app.post('/api/create-tts', async (req, res) => {
    // ... (이전과 동일)
});

// 영상 렌더링 API
app.post('/render-video', async (req, res) => {
    console.log("실제 영상 렌더링 요청 받음!");
    const projectData = req.body;

    const renderId = `render_${Date.now()}`;
    const tempDir = path.join(__dirname, 'temp', renderId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio'); // 오디오 저장 폴더
    const finalAudioPath = path.join(tempDir, 'final_audio.mp3'); // 최종 오디오 파일
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    let browser; 

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);
        console.log(`[${renderId}] 임시 폴더 생성 완료`);

        // [수정] 비디오 렌더링과 오디오 다운로드를 병렬로 처리
        const videoRenderPromise = (async () => {
            browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1920 });
            const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
            await page.goto(templatePath, { waitUntil: 'networkidle0' });
            
            let frameCount = 0;
            const fps = 30;

            for (const card of projectData.scriptCards) {
                const cardFrames = Math.floor(card.duration * fps);
                for (let i = 0; i < cardFrames; i++) {
                    await page.evaluate((projectData, cardData) => {
                        // ... (이전의 완성형 page.evaluate 로직은 동일)
                    }, projectData, card);

                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                }
            }
            await browser.close();
            console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        })();
        
        // [추가] 오디오 트랙 생성 로직
        const audioRenderPromise = (async () => {
            const audioInputs = [];
            let currentTime = 0;
            
            // 1. 필요한 모든 오디오 파일 다운로드
            for (const [index, card] of projectData.scriptCards.entries()) {
                if (card.audioUrl) {
                    const audioPath = path.join(audioDir, `tts_${index}.mp3`);
                    const response = await fetch(card.audioUrl);
                    const buffer = await response.buffer();
                    await fs.writeFile(audioPath, buffer);
                    audioInputs.push({ path: audioPath, time: currentTime, volume: card.ttsVolume });
                }
                currentTime += card.duration;
            }
            // TODO: BGM, SFX 다운로드 로직 추가 필요

            if (audioInputs.length === 0) {
                console.log(`[${renderId}] 오디오 트랙 없음`);
                return; // 오디오 파일이 없으면 여기서 종료
            }

            // 2. FFmpeg로 오디오 믹싱 (지금은 TTS만 순서대로 이어붙이기)
            // amix 필터를 사용하면 더 복잡한 믹싱이 가능
            const inputClauses = audioInputs.map(a => `-i "${a.path}"`).join(' ');
            const filterClauses = audioInputs.map((a, i) => `[${i}:a]adelay=${a.time * 1000}|${a.time * 1000}[a${i}]`).join(';');
            const concatClause = audioInputs.map((a, i) => `[a${i}]`).join('') + `amix=inputs=${audioInputs.length}`;

            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterClauses};${concatClause}" -y "${finalAudioPath}"`;
            
            console.log(`[${renderId}] 오디오 믹싱 실행...`);
            await new Promise((resolve, reject) => {
                exec(mixCommand, (error, stdout, stderr) => {
                    if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(error); }
                    resolve(stdout);
                });
            });
            console.log(`[${renderId}] 최종 오디오 파일 생성 완료`);
        })();

        // 비디오 렌더링과 오디오 생성이 모두 끝날 때까지 기다림
        await Promise.all([videoRenderPromise, audioRenderPromise]);
        
        // 4. FFmpeg로 영상과 오디오 최종 합성
        const hasAudio = fs.existsSync(finalAudioPath);
        const audioInputClause = hasAudio ? `-i "${finalAudioPath}"` : '';
        const audioCodecClause = hasAudio ? '-c:a aac -shortest' : '';

        const ffmpegCommand = `ffmpeg -framerate ${fps} -i "${path.join(framesDir, 'frame_%06d.png')}" ${audioInputClause} -c:v libx264 -pix_fmt yuv420p ${audioCodecClause} -y "${outputVideoPath}"`;
        
        console.log(`[${renderId}] 최종 영상 합성 실행...`);
        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) { console.error('최종 합성 오류:', stderr); return reject(new Error('FFmpeg 실행 실패')); }
                resolve(stdout);
            });
        });
        
        console.log(`[${renderId}] 최종 영상 합성 완료`);

        // 5. 다운로드 및 정리
        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) console.error('파일 다운로드 오류:', err);
            await fs.remove(tempDir);
            console.log(`[${renderId}] 임시 폴더 삭제 완료`);
        });

    } catch (error) {
        console.error('TTS 중계 중 오류 발생:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================================
// 실제 영상 렌더링 API (최종 강화 버전)
// ==========================================================
app.post('/render-video', async (req, res) => {
    console.log("실제 영상 렌더링 요청 받음!");
    const projectData = req.body;

    const renderId = `render_${Date.now()}`;
    const tempDir = path.join(__dirname, 'temp', renderId);
    const framesDir = path.join(tempDir, 'frames');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    let browser; 

    try {
        await fs.ensureDir(framesDir);
        console.log(`[${renderId}] 임시 폴더 생성 완료: ${tempDir}`);

        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1080, height: 1920 });

        const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
        await page.goto(templatePath, { waitUntil: 'networkidle0' });
        console.log(`[${renderId}] 렌더링 템플릿 로드 완료`);

        let frameCount = 0;
        const fps = 30;

        for (const card of projectData.scriptCards) {
            const cardFrames = Math.floor(card.duration * fps);
            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                // Puppeteer의 브라우저 내부에서 실행될 완성형 렌더링 함수
                await page.evaluate((projectData, cardData, t) => {
                    // --- 1. 정적 요소 렌더링 (헤더, 프로젝트 정보) ---
                    const pSettings = projectData.projectSettings;
                    
                    // 헤더
                    const headerEl = document.querySelector('.st-preview-header');
                    const headerTitleEl = headerEl.querySelector('.header-title');
                    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                    headerTitleEl.innerText = pSettings.header.text;
                    headerTitleEl.style.color = pSettings.header.color;
                    headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                    headerTitleEl.style.fontSize = `${pSettings.header.fontSize}px`;
                    
                    // 프로젝트 정보
                    const projectInfoEl = document.querySelector('.st-project-info');
                    const projectInfoTitleEl = projectInfoEl.querySelector('.title');
                    const projectInfoSpanEl = projectInfoEl.querySelector('span');
                    
                    projectInfoTitleEl.innerText = pSettings.project.title;
                    projectInfoTitleEl.style.color = pSettings.project.titleColor;
                    projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                    projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize}px`;
                    projectInfoTitleEl.style.fontWeight = 'bold';
                    
                    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                    projectInfoSpanEl.style.color = pSettings.project.metaColor;

                    // --- 2. 카드별 동적 요소 렌더링 ---
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                    const textEl = document.querySelector('#st-preview-text');
                    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                    const imageEl = document.querySelector('#st-preview-image');
                    const videoEl = document.querySelector('#st-preview-video');
                    
                    // 텍스트 내용, 스타일, 위치 적용
                    textEl.style.whiteSpace = 'pre-wrap';
                    textEl.textContent = cardData.text; 
                    Object.assign(textEl.style, cardData.style);
                    
                    textWrapper.style.transform = `translate(${cardData.layout.text.x || 0}px, ${cardData.layout.text.y || 0}px) scale(${cardData.layout.text.scale || 1}) rotate(${cardData.layout.text.angle || 0}deg)`;

                    // 미디어 내용, 스타일, 위치 적용
                    if (cardData.media.url) {
                        mediaWrapper.style.display = 'flex';
                        mediaWrapper.style.transform = `translate(${cardData.layout.media.x || 0}px, ${cardData.layout.media.y || 0}px) scale(${cardData.layout.media.scale || 1}) rotate(${cardData.layout.media.angle || 0}deg)`;
                        
                        if (cardData.media.type === 'image') {
                            imageEl.style.display = 'block';
                            videoEl.style.display = 'none';
                            imageEl.src = cardData.media.url;
                            imageEl.style.objectFit = cardData.media.fit;
                        } else {
                            videoEl.style.display = 'none';
                            imageEl.style.display = 'none';
                        }
                    } else {
                        mediaWrapper.style.display = 'none';
                    }

                }, projectData, card, timeInCard);

                // 프레임 캡처
                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                frameCount++;
            }
        }
        
        console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        await browser.close();

        // 4. FFmpeg로 영상 합성 (오디오는 다음 단계에서 추가)
        const ffmpegCommand = `ffmpeg -framerate ${fps} -i "${path.join(framesDir, 'frame_%06d.png')}" -c:v libx264 -pix_fmt yuv420p -y "${outputVideoPath}"`;
        
        console.log(`[${renderId}] FFmpeg 실행...`);
        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('FFmpeg 오류:', stderr);
                    return reject(new Error('FFmpeg 실행 실패'));
                }
                resolve(stdout);
            });
        });
        
        console.log(`[${renderId}] 영상 합성 완료: ${outputVideoPath}`);

        // 5. 완성된 영상 파일 다운로드
        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) {
                console.error('파일 다운로드 오류:', err);
            }
            await fs.remove(tempDir);
            console.log(`[${renderId}] 임시 폴더 삭제 완료`);
        });

    } catch (error) {
        console.error(`[${renderId}] 렌더링 중 오류 발생:`, error);
        if (browser) await browser.close();
        if (await fs.pathExists(tempDir)) {
            await fs.remove(tempDir);
        }
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: '영상 생성 중 오류가 발생했습니다.' });
        }
    }
});


app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 실행되었습니다!`);
    console.log(`  브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
    console.log(`=============================================`);
});
