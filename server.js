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

    let browser; // 나중에 finally에서 닫기 위해 외부에 선언

    try {
        await fs.ensureDir(framesDir);
        console.log(`[${renderId}] 임시 폴더 생성 완료: ${tempDir}`);

        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1080, height: 1920 });

        const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
        await page.goto(templatePath, { waitUntil: 'networkidle0' });
        console.log(`[${renderId}] 렌더링 템플릿 로드 완료`);
        
        // 애니메이션 CSS를 동적으로 주입하기 위한 준비
        const animationCss = fs.readFileSync(path.join(__dirname, 'animations.css'), 'utf-8');
        await page.addStyleTag({ content: animationCss });

        let frameCount = 0;
        const fps = 30;

        // 전체 프로젝트 렌더링 시작
        for (const card of projectData.scriptCards) {
            const cardFrames = Math.floor(card.duration * fps);

            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                // Puppeteer의 브라우저 내부에서 실행될 정교한 렌더링 함수
                await page.evaluate((projectData, cardData, t) => {
                    
                    // --- 1. 정적 요소 렌더링 (매번 동일) ---
                    const header = projectData.projectSettings.header;
                    const headerEl = document.querySelector('.st-preview-header');
                    headerEl.style.backgroundColor = header.backgroundColor;
                    headerEl.querySelector('.header-title').innerText = header.text;
                    headerEl.querySelector('.header-title').style.color = header.color;
                    headerEl.querySelector('.header-title').style.fontFamily = header.fontFamily;
                    headerEl.querySelector('.header-title').style.fontSize = `${header.fontSize}px`;
                    // TODO: header.icon, header.logo 구현

                    const project = projectData.projectSettings.project;
                    document.querySelector('.st-project-info .title').innerText = project.title;
                    document.querySelector('.st-project-info span').innerText = `${project.author || ''} | 조회수 ${Number(project.views || 0).toLocaleString()}`;
                    document.querySelector('.st-project-info .title').style.color = project.titleColor;
                    document.querySelector('.st-project-info span').style.color = project.metaColor;

                    // --- 2. 카드별 요소 렌더링 ---
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                    const textEl = document.querySelector('#st-preview-text');
                    const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                    const imageEl = document.querySelector('#st-preview-image');
                    const videoEl = document.querySelector('#st-preview-video');
                    
                    // 텍스트 스타일 및 위치 적용
                    Object.assign(textEl.style, cardData.style);
                    textWrapper.style.transform = `translate(${cardData.layout.text.x || 0}px, ${cardData.layout.text.y || 0}px) scale(${cardData.layout.text.scale || 1}) rotate(${cardData.layout.text.angle || 0}deg)`;

                    // 미디어 스타일 및 위치 적용
                    if (cardData.media.url) {
                        mediaWrapper.style.display = 'block';
                        mediaWrapper.style.transform = `translate(${cardData.layout.media.x || 0}px, ${cardData.layout.media.y || 0}px) scale(${cardData.layout.media.scale || 1}) rotate(${cardData.layout.media.angle || 0}deg)`;
                        
                        if (cardData.media.type === 'image') {
                            imageEl.style.display = 'block';
                            videoEl.style.display = 'none';
                            imageEl.src = cardData.media.url; // Base64 데이터를 바로 src에 넣음
                            imageEl.style.objectFit = cardData.media.fit;
                        } // TODO: 비디오 렌더링 구현
                    } else {
                        mediaWrapper.style.display = 'none';
                    }

                    // --- 3. 시간 기반 렌더링 (애니메이션, 텍스트 순서) ---
                    
                    // 텍스트 줄별 순서 렌더링
                    textEl.innerHTML = ''; // 일단 비우고
                    const linesToShow = cardData.animationSequence.length > 0 ? cardData.segments : cardData.text.split('\n').map(line => ({ text: line, startTime: 0 }));
                    
                    linesToShow.forEach(segment => {
                        if (t >= segment.startTime) {
                            const p = document.createElement('p');
                            p.textContent = segment.text || ' ';
                            p.style.margin = 0;
                            textEl.appendChild(p);
                        }
                    });

                    // 애니메이션 상태 적용
                    const applyAnimationState = (el, animIn, animOut, duration) => {
                        // (이전에 exporter에 있던 애니메이션 계산 로직을 여기에 구현)
                        // ...
                    };
                    // applyAnimationState(textWrapper, cardData.animations.text.in, ...);
                    // applyAnimationState(mediaWrapper, cardData.animations.media.in, ...);


                }, projectData, card, timeInCard);

                // 프레임 캡처
                const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath });
                frameCount++;
            }
        }
        
        console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        
        // 4. FFmpeg로 영상 합성 (오디오는 다음 단계)
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

        // 5. 완성된 영상 파일 스트림으로 전송
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(projectData.projectSettings.project.title || 'sunsak-video')}.mp4"`);
        const fileStream = fs.createReadStream(outputVideoPath);
        fileStream.pipe(res);
        fileStream.on('close', async () => {
            if (browser) await browser.close();
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
