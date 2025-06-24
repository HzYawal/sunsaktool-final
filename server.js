// server.js
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ※※※ TTS 중계 API (Netlify 함수가 있다면 필요, 없다면 이 부분은 무시해도 됩니다) ※※※
// const fetch = require('node-fetch');
// app.post('/api/create-tts', ...);


// ==========================================================
// ▼▼▼ 실제 영상 렌더링 API ▼▼▼
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

        // ※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※
        // ※※※ 여기가 실제 렌더링 로직의 핵심입니다 ※※※
        // ※※※ 전문가가 프로젝트 데이터 구조에 맞춰 정교하게 구현해야 합니다.
        // ※※※ 지금은 개념 증명을 위해 매우 단순하게 구현합니다.
        // ※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※※

        let frameCount = 0;
        const fps = 30;

        for (const card of projectData.scriptCards) {
            const cardFrames = Math.floor(card.duration * fps);
            for (let i = 0; i < cardFrames; i++) {
                
                // Puppeteer의 브라우저 내부에서 실행될 함수
                await page.evaluate((cardData) => {
                    const textEl = document.querySelector('#st-preview-text');
                    if (textEl) {
                        textEl.innerText = cardData.text;
                        Object.assign(textEl.style, cardData.style);
                    }
                    // TODO: 이미지, 비디오, 헤더, 프로젝트 정보, 레이아웃 등 모든 상태를 여기에 적용해야 함
                }, card);

                // 프레임 캡처
                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                frameCount++;
            }
        }
        
        console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        await browser.close();

        // 4. FFmpeg로 영상 합성 (지금은 오디오 없이 비디오만 만듭니다)
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
