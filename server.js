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
// 영상 렌더링 API (모든 기능 포함 최종본)
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

        const videoRenderPromise = (async () => {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
            const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
            await page.goto(templatePath, { waitUntil: 'networkidle0' });
            
            let frameCount = 0;
            const scaleRatio = 1080 / projectData.renderMetadata.sourceWidth;

            for (const card of projectData.scriptCards) {
                const cardFrames = Math.floor(card.duration * fps);
                for (let i = 0; i < cardFrames; i++) {
                    const timeInCard = i / fps;
                    
                    await page.evaluate((projectData, cardData, t, scale) => {
                        const pSettings = projectData.projectSettings;
                        
                        // 헤더 렌더링
                        const headerEl = document.querySelector('.st-preview-header');
                        const headerTitleEl = headerEl.querySelector('.header-title');
                        headerEl.style.height = `${65 * scale}px`;
                        headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                        headerTitleEl.innerText = pSettings.header.text;
                        headerTitleEl.style.color = pSettings.header.color;
                        headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                        headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
                        
                        // 프로젝트 정보 렌더링
                        const projectInfoTitleEl = document.querySelector('.st-project-info .title');
                        const projectInfoSpanEl = document.querySelector('.st-project-info span');
                        projectInfoTitleEl.innerText = pSettings.project.title;
                        projectInfoTitleEl.style.color = pSettings.project.titleColor;
                        projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                        projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`;
                        projectInfoTitleEl.style.fontWeight = 'bold';
                        projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                        projectInfoSpanEl.style.color = pSettings.project.metaColor;
                        projectInfoSpanEl.style.fontSize = `${13 * scale}px`;

                        // 텍스트 및 미디어 요소 선택
                        const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                        const textEl = document.querySelector('#st-preview-text');
                        const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                        const imageEl = document.querySelector('#st-preview-image');

                        // 텍스트/미디어 레이아웃 적용
                        const scaledStyle = { ...cardData.style };
                        scaledStyle.fontSize = `${parseFloat(cardData.style.fontSize) * scale}px`;
                        scaledStyle.letterSpacing = `${parseFloat(cardData.style.letterSpacing) * scale}px`;
                        Object.assign(textEl.style, scaledStyle);
                        textWrapper.style.transform = `translate(${cardData.layout.text.x * scale}px, ${cardData.layout.text.y * scale}px) scale(${cardData.layout.text.scale || 1}) rotate(${cardData.layout.text.angle || 0}deg)`;

                        if (cardData.media.url) {
                            mediaWrapper.style.display = 'flex';
                            mediaWrapper.style.transform = `translate(${cardData.layout.media.x * scale}px, ${cardData.layout.media.y * scale}px) scale(${cardData.layout.media.scale || 1}) rotate(${cardData.layout.media.angle || 0}deg)`;
                            imageEl.src = cardData.media.url;
                            imageEl.style.display = 'block';
                        } else {
                            mediaWrapper.style.display = 'none';
                        }
                        
                        // 텍스트 줄별 순서대로 나타나기
                        textEl.innerHTML = '';
                        const linesToRender = cardData.segments && cardData.segments.length > 0 ? cardData.segments : [{ text: cardData.text, startTime: 0 }];
                        linesToRender.forEach(segment => {
                            if (t >= segment.startTime) {
                                const p = document.createElement('p');
                                p.textContent = segment.text || ' ';
                                p.style.margin = 0;
                                textEl.appendChild(p);
                            }
                        });

                    }, projectData, card, timeInCard, scaleRatio);

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
                    const ttsPath = path.join(audioDir, `tts_${index}.mp3`);
                    const base64Data = card.audioUrl.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    await fs.writeFile(ttsPath, buffer);
                    audioInputs.push({ type: 'tts', path: ttsPath, time: currentTime, volume: card.ttsVolume || 1.0, speed: card.ttsSettings.speed || 1.0 });
                }
                currentTime += card.duration;
            }

            if (projectData.globalBGM && projectData.globalBGM.url) {
                const bgmPath = path.join(audioDir, `bgm.mp3`);
                const response = await fetch(projectData.globalBGM.url);
                await fs.writeFile(bgmPath, await response.buffer());
                audioInputs.push({ type: 'bgm', path: bgmPath, volume: projectData.globalBGM.volume || 0.3 });
            }

            if (audioInputs.length === 0) {
                console.log(`[${renderId}] 오디오 트랙 없음`);
                return null;
            }

            const inputClauses = audioInputs.map(a => `-i "${a.path}"`).join(' ');
            let filterComplex = '';
            const outputStreams = [];

            audioInputs.forEach((audio, index) => {
                let stream = `[${index}:a]`;
                if (audio.type === 'tts') {
                    stream += `atempo=${audio.speed},volume=${audio.volume}[tts${index}];`;
                    stream += `[tts${index}]adelay=${audio.time * 1000}|${audio.time * 1000}[a${index}]`;
                } else if (audio.type === 'bgm') {
                    stream += `volume=${audio.volume}[a${index}]`;
                }
                filterComplex += stream;
                if(index < audioInputs.length -1) filterComplex += ';';
                outputStreams.push(`[a${index}]`);
            });
            
            filterComplex += `${outputStreams.join('')}amix=inputs=${audioInputs.length}:duration=longest`;

            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
            
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

        const [_, audioPathResult] = await Promise.all([videoRenderPromise, audioRenderPromise]);
        
        const hasAudio = audioPathResult && fs.existsSync(audioPathResult);
        const audioInputClause = hasAudio ? `-i "${audioPathResult}"` : '';
        const totalDuration = projectData.scriptCards.reduce((sum, card) => sum + card.duration, 0);
        
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
