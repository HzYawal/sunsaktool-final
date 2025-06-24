const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fetch = require('node-fetch'); // TTS 중계를 위해 필요합니다.

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));


// ==========================================================
// ▼▼▼ TTS 중계 API (이 부분이 추가되었습니다) ▼▼▼
// ==========================================================
app.post('/api/create-tts', async (req, res) => {
    console.log("TTS 중계 요청 받음:", req.body);
    try {
        // 실제 Netlify 함수 URL로 요청을 전달합니다.
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
// ▼▼▼ 실제 영상 렌더링 API (기존과 동일) ▼▼▼
// ==========================================================
app.post('/render-video', async (req, res) => {
    console.log("실제 영상 렌더링 요청 받음!");
    const projectData = req.body;

    const renderId = `render_${Date.now()}`;
    const tempDir = path.join(__dirname, 'temp', renderId);
    const framesDir = path.join(tempDir, 'frames');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    try {
        await fs.ensureDir(framesDir);
        console.log(`[${renderId}] 임시 폴더 생성 완료: ${tempDir}`);

        const browser = await puppeteer.launch({ headless: true });
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
                
                // ▼▼▼▼▼ 이 page.evaluate 함수를 업그레이드합니다 ▼▼▼▼▼
                await page.evaluate((projectData, cardData) => {
                    // 이 코드는 Puppeteer의 가상 브라우저 안에서 실행됩니다.
                    
                    // 1. 헤더 설정
                    const header = projectData.projectSettings.header;
                    const headerEl = document.querySelector('.st-preview-header');
                    headerEl.style.backgroundColor = header.backgroundColor;
                    headerEl.querySelector('.header-title').innerText = header.text;
                    // TODO: 헤더 아이콘, 로고 등 추가 구현 필요

                    // 2. 프로젝트 정보 설정
                    const project = projectData.projectSettings.project;
                    document.querySelector('.st-project-info .title').innerText = project.title;
                    document.querySelector('.st-project-info span').innerText = `${project.author || ''} | 조회수 ${Number(project.views || 0).toLocaleString()}`;
                    
                    // 3. 텍스트 요소 설정
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                    const textEl = document.querySelector('#st-preview-text');
                    
                    textEl.innerText = cardData.text;
                    Object.assign(textEl.style, cardData.style);
                    textWrapper.style.transform = `translate(${cardData.layout.text.x || 0}px, ${cardData.layout.text.y || 0}px) scale(${cardData.layout.text.scale || 1}) rotate(${cardData.layout.text.angle || 0}deg)`;

                    // 4. 미디어 요소 설정
                    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                    const imageEl = document.querySelector('#st-preview-image');
                    const videoEl = document.querySelector('#st-preview-video');
                    
                    if (cardData.media.url) {
                        mediaWrapper.style.display = 'block';
                        mediaWrapper.style.transform = `translate(${cardData.layout.media.x || 0}px, ${cardData.layout.media.y || 0}px) scale(${cardData.layout.media.scale || 1}) rotate(${cardData.layout.media.angle || 0}deg)`;

                        if (cardData.media.type === 'image') {
                            imageEl.style.display = 'block';
                            videoEl.style.display = 'none';
                            imageEl.src = cardData.media.url; // 여기서 URL이 blob: 형태라면 문제가 될 수 있습니다.
                            imageEl.style.objectFit = cardData.media.fit;
                        } else {
                            // 비디오 렌더링은 훨씬 더 복잡합니다. (지금은 일단 생략)
                            videoEl.style.display = 'none';
                            imageEl.style.display = 'none';
                        }
                    } else {
                        mediaWrapper.style.display = 'none';
                    }

                    // TODO: 애니메이션, 줄별 나타나기 등 시간(timeInCard)에 따른 변화 구현 필요

                }, projectData, card); // projectData와 cardData를 함께 넘겨줍니다.
                // ▲▲▲▲▲ 여기까지가 업그레이드된 부분입니다 ▲▲▲▲▲

                // 프레임 캡처 (이 부분은 동일)
                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                frameCount++;
            }
        }
        
        console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        await browser.close();

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

        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) {
                console.error('파일 다운로드 오류:', err);
            }
            await fs.remove(tempDir);
            console.log(`[${renderId}] 임시 폴더 삭제 완료`);
        });

    } catch (error) {
        console.error(`[${renderId}] 렌더링 중 오류 발생:`, error);
        res.status(500).json({ success: false, message: '영상 생성 중 오류가 발생했습니다.' });
        if (await fs.pathExists(tempDir)) {
            await fs.remove(tempDir);
        }
    }
});


app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 실행되었습니다!`);
    console.log(`  브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
    console.log(`=============================================`);
});
