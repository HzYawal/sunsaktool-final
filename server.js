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

// ==========================================================
// TTS 중계 API
// ==========================================================
app.post('/api/create-tts', async (req, res) => {
    console.log("TTS 중계 요청 받음:", req.body);
    try {
        const ttsResponse = await fetch('https://sunsaktool-final.netlify.app/.netlify/functions/create-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error('Netlify 함수 오류 응답:', errorText);
            throw new Error(`Netlify 함수 오류: ${ttsResponse.statusText}`);
        }

        const result = await ttsResponse.json();
        res.json(result);

    } catch (error) {
        console.error('TTS 중계 중 오류 발생:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================================
// 영상 렌더링 API (최종 완성본)
// ==========================================================
app.post('/render-video', async (req, res) => {
    console.log("실제 영상 렌더링 요청 받음!");
    const projectData = req.body;
    const fps = 30;
    const renderId = `render_${Date.now()}`;
    const tempDir = path.join(__dirname, 'temp', renderId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.mp3');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    let browser;

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);
        console.log(`[${renderId}] 임시 폴더 생성 완료`);

        // 비디오 프레임 렌더링과 오디오 트랙 생성을 병렬로 처리
        const videoRenderPromise = (async () => {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
            const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
            await page.goto(templatePath, { waitUntil: 'networkidle0' });
            
            let frameCount = 0;
            for (const card of projectData.scriptCards) {
                const cardFrames = Math.floor(card.duration * fps);
                for (let i = 0; i < cardFrames; i++) {
                    const timeInCard = i / fps;
                    
                    await page.evaluate((projectData, cardData, t) => {
                        // [추가] 스케일 비율 계산
                        const sourceWidth = projectData.renderMetadata.sourceWidth;
                        const targetWidth = 1080; // 렌더링 목표 너비
                        const scaleRatio = targetWidth / sourceWidth;

                        // --- 1. 정적 요소 렌더링 (헤더, 프로젝트 정보) ---
                        const pSettings = projectData.projectSettings;
                        
                        // 헤더
                        const headerEl = document.querySelector('.st-preview-header');
                        const headerTitleEl = headerEl.querySelector('.header-title');
                        headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                        headerTitleEl.innerText = pSettings.header.text;
                        headerTitleEl.style.color = pSettings.header.color;
                        headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                        headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scaleRatio}px`; // 스케일링
                        
                        // 프로젝트 정보
                        const projectInfoTitleEl = document.querySelector('.st-project-info .title');
                        const projectInfoSpanEl = document.querySelector('.st-project-info span');
                        projectInfoTitleEl.innerText = pSettings.project.title;
                        projectInfoTitleEl.style.color = pSettings.project.titleColor;
                        projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                        projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scaleRatio}px`; // 스케일링
                        projectInfoTitleEl.style.fontWeight = 'bold';
                        projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                        projectInfoSpanEl.style.color = pSettings.project.metaColor;
                        // [추가] 하단 정보 폰트 크기도 스케일링
                        projectInfoSpanEl.style.fontSize = `${13 * scaleRatio}px`;


                        // --- 2. 카드별 동적 요소 렌더링 ---
                        const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                        const textEl = document.querySelector('#st-preview-text');
                        
                        textEl.innerHTML = '';
                        cardData.text.split('\n').forEach(line => {
                            const p = document.createElement('p');
                            p.textContent = line || ' ';
                            p.style.margin = 0;
                            textEl.appendChild(p);
                        });

                        // [수정] 스타일 객체의 모든 수치 값을 스케일링
                        const scaledStyle = { ...cardData.style };
                        scaledStyle.fontSize = `${parseFloat(cardData.style.fontSize) * scaleRatio}px`;
                        scaledStyle.letterSpacing = `${parseFloat(cardData.style.letterSpacing) * scaleRatio}px`;
                        Object.assign(textEl.style, scaledStyle);
                        
                        // [수정] 레이아웃 좌표도 스케일링
                        textWrapper.style.transform = `translate(${cardData.layout.text.x * scaleRatio}px, ${cardData.layout.text.y * scaleRatio}px) scale(${cardData.layout.text.scale || 1}) rotate(${cardData.layout.text.angle || 0}deg)`;

                    }, projectData, card, timeInCard);

                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                }
            }
            if (browser) await browser.close();
            console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        })();
        
        const audioRenderPromise = (async () => {
            const audioInputs = [];
            let currentTime = 0;
            
            for (const [index, card] of projectData.scriptCards.entries()) {
                if (card.audioUrl && card.audioUrl.startsWith('data:')) {
                    const audioPath = path.join(audioDir, `tts_${index}.mp3`);
                    const base64Data = card.audioUrl.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    await fs.writeFile(audioPath, buffer);
                    audioInputs.push({ path: audioPath, time: currentTime });
                }
                currentTime += card.duration;
            }

            if (audioInputs.length === 0) {
                console.log(`[${renderId}] 오디오 트랙 없음`);
                return null;
            }

            const inputClauses = audioInputs.map(a => `-i "${a.path}"`).join(' ');
            const filterClauses = audioInputs.map((a, i) => `[${i}:a]adelay=${a.time * 1000}|${a.time * 1000}[a${i}]`).join(';');
            const mixClause = audioInputs.map((a, i) => `[a${i}]`).join('') + `amix=inputs=${audioInputs.length}:duration=longest`;
            
            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterClauses};${mixClause}" -y "${finalAudioPath}"`;
            
            console.log(`[${renderId}] 오디오 믹싱 실행...`);
            await new Promise((resolve, reject) => {
                exec(mixCommand, (error, stdout, stderr) => {
                    if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(error); }
                    resolve(stdout);
                });
            });
            console.log(`[${renderId}] 최종 오디오 파일 생성 완료`);
            return finalAudioPath;
        })();

        // 비디오와 오디오 작업이 모두 끝날 때까지 기다림
        const [_, audioPathResult] = await Promise.all([videoRenderPromise, audioRenderPromise]);
        
        const hasAudio = audioPathResult && fs.existsSync(audioPathResult);
        const audioInputClause = hasAudio ? `-i "${audioPathResult}"` : '';
        const totalDuration = projectData.scriptCards.reduce((sum, card) => sum + card.duration, 0);
        
        // 오디오 유무에 따라 명령어 분기
        const durationClause = hasAudio ? '-shortest' : `-t ${totalDuration}`;
        const ffmpegCommand = `ffmpeg -framerate ${fps} -i "${path.join(framesDir, 'frame_%06d.png')}" ${audioInputClause} -c:v libx264 -pix_fmt yuv420p -c:a aac ${durationClause} -y "${outputVideoPath}"`;
        
        console.log(`[${renderId}] 최종 영상 합성 실행...`);
        await new Promise((resolve, reject) => {
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) { console.error('최종 합성 오류:', stderr); return reject(new Error('FFmpeg 실행 실패')); }
                resolve(stdout);
            });
        });
        
        console.log(`[${renderId}] 최종 영상 합성 완료`);

        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) console.error('파일 다운로드 오류:', err);
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
