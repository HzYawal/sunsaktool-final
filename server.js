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


// 영상 렌더링 API
app.post('/render-video', async (req, res) => {
    console.log("실제 영상 렌더링 요청 받음!");
    const projectData = req.body;
    
    // [수정] fps 변수를 여기 최상단에 선언합니다.
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
            // [수정] deviceScaleFactor를 2로 설정하여 고해상도 렌더링
            await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
            const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
            await page.goto(templatePath, { waitUntil: 'networkidle0' });
            
            let frameCount = 0;

            for (const card of projectData.scriptCards) {
                const cardFrames = Math.floor(card.duration * fps);
                for (let i = 0; i < cardFrames; i++) {
                    await page.evaluate((projectData, cardData) => {
                        document.body.className = 'st-main-container'; // [추가] CSS 변수가 적용되도록 클래스 추가
                        // ... (이전의 완성형 page.evaluate 로직은 동일) ...
                    }, projectData, card);

                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                }
            }
            await browser.close();
            console.log(`[${renderId}] 총 ${frameCount}개 프레임 캡처 완료`);
        })();
        
        const audioRenderPromise = (async () => {
            const audioInputs = [];
            let currentTime = 0;
            const totalDuration = projectData.scriptCards.reduce((sum, card) => sum + card.duration, 0);

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

            if (audioInputs.length === 0) return null;

            const inputClauses = audioInputs.map(a => `-i "${a.path}"`).join(' ');
            const filterClauses = audioInputs.map((a, i) => `[${i}:a]adelay=${a.time * 1000}|${a.time * 1000}[a${i}]`).join(';');
            const concatClause = audioInputs.map((a, i) => `[a${i}]`).join('') + `amix=inputs=${audioInputs.length}`;
            
            // [수정] 최종 오디오 길이를 영상 전체 길이로 설정
            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterClauses};${concatClause}" -t ${totalDuration} -y "${finalAudioPath}"`;
            
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
        const audioCodecClause = hasAudio ? '-c:a aac' : '';
        const totalDuration = projectData.scriptCards.reduce((sum, card) => sum + card.duration, 0);

        // [수정] -shortest 제거하고, -t 옵션으로 전체 길이 명시
        const ffmpegCommand = `ffmpeg -framerate ${fps} -i "${path.join(framesDir, 'frame_%06d.png')}" ${audioInputClause} -c:v libx264 -pix_fmt yuv420p ${audioCodecClause} -t ${totalDuration} -y "${outputVideoPath}"`;
        
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
