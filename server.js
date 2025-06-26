// ================== [server.js 전체 코드 시작] ==================
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const cors = require('cors');
const { URL } = require('url'); // URL 파싱을 위해 추가

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// ==========================================================
// 구글 TTS API (이 부분은 변경 없음)
// ==========================================================
app.post('/api/create-tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'TTS로 변환할 텍스트가 없습니다.' });
    }
    const selectedVoice = voice || 'ko-KR-Standard-C';
    const speakingRate = parseFloat(speed) || 1.0; 
    const client = new TextToSpeechClient();
    const ssmlText = `<speak><prosody rate="${speakingRate}">${text}</prosody></speak>`;
    try {
        const request = {
            input: { ssml: ssmlText }, 
            voice: { languageCode: 'ko-KR', name: selectedVoice },
            audioConfig: { audioEncoding: 'MP3' },
        };
        const [response] = await client.synthesizeSpeech(request);
        const audioBase64 = response.audioContent.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
        res.json({ audioUrl: audioUrl });
    } catch (error) {
        console.error('구글 TTS API 호출 중 오류 발생:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================================
// 영상 렌더링 API (V3: GIF, 비디오 지원 및 모든 버그 수정 최종판)
// ==========================================================
app.post('/render-video', async (req, res) => {
    console.log("영상 렌더링 요청 시작 (V3: 2-Pass 렌더링)");
    const projectData = req.body;
    const fps = 30;
    const renderId = `render_${Date.now()}`;
    const tempDir = path.join(__dirname, 'temp', renderId);
    const overlayFramesDir = path.join(tempDir, 'overlay_frames'); // 투명 텍스트 프레임
    const mediaDir = path.join(tempDir, 'media'); // 사용자 미디어 저장
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.mp3');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    let browser;

    try {
        await fs.ensureDir(overlayFramesDir);
        await fs.ensureDir(mediaDir);
        await fs.ensureDir(audioDir);
        console.log(`[${renderId}] 임시 폴더 생성`);

        // ==========================================================
        // PASS 1: Puppeteer로 투명 배경 텍스트 오버레이 렌더링
        // ==========================================================
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1080, height: 1920 });
        
        const renderTemplateContent = await fs.readFile(path.join(__dirname, 'render_template.html'), 'utf-8');
        await page.setContent(renderTemplateContent);
        
        // Pass 1에서는 모든 미디어를 숨김
        await page.evaluate(() => {
            document.body.style.backgroundColor = 'transparent';
            document.documentElement.style.backgroundColor = 'transparent';
            const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
            if (mediaWrapper) mediaWrapper.style.display = 'none';
        });

        let frameCount = 0;
        let totalDurationForFrames = 0;
        for (const card of projectData.scriptCards) {
            const cardFrames = Math.floor(card.duration * fps);
            for (let i = 0; i < cardFrames; i++) {
                const timeInCard = i / fps;
                
                await page.evaluate((project, currentCard, t, scale) => {
                    const pSettings = project.projectSettings;
                    const headerEl = document.querySelector('.st-preview-header');
                    const headerTitleEl = headerEl.querySelector('.header-title');
                    const headerIconEl = headerEl.querySelector('.header-icon');
                    const headerLogoEl = headerEl.querySelector('.header-logo');
                    headerEl.style.height = `${65 * scale}px`;
                    headerEl.style.padding = `0 ${15 * scale}px`;
                    headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                    headerTitleEl.innerText = pSettings.header.text;
                    headerTitleEl.style.color = pSettings.header.color;
                    headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                    headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
                    const iconSVG = { back: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`, menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>` };
                    headerIconEl.innerHTML = iconSVG[pSettings.header.icon] || '';
                    if (pSettings.header.logo.url) { headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`; headerLogoEl.style.display = 'block'; if (headerLogoEl.src !== pSettings.header.logo.url) { headerLogoEl.src = pSettings.header.logo.url; } } else { headerLogoEl.style.display = 'none'; }
                    const projectInfoEl = document.querySelector('.st-project-info');
                    projectInfoEl.style.paddingBottom = `${16 * scale}px`;
                    projectInfoEl.style.marginBottom = `${16 * scale}px`;
                    const projectInfoTitleEl = projectInfoEl.querySelector('.title');
                    projectInfoTitleEl.innerText = pSettings.project.title;
                    projectInfoTitleEl.style.color = pSettings.project.titleColor;
                    projectInfoTitleEl.style.fontFamily = pSettings.project.titleFontFamily;
                    projectInfoTitleEl.style.fontSize = `${pSettings.project.titleFontSize * scale}px`;
                    projectInfoTitleEl.style.marginBottom = `${5 * scale}px`;
                    const projectInfoSpanEl = projectInfoEl.querySelector('span');
                    projectInfoSpanEl.innerText = `${pSettings.project.author || ''} | 조회수 ${Number(pSettings.project.views || 0).toLocaleString()}`;
                    projectInfoSpanEl.style.color = pSettings.project.metaColor;
                    projectInfoSpanEl.style.fontSize = `${13 * scale}px`;
                    const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                    const textEl = document.querySelector('#st-preview-text');
                    const scaledStyle = { ...currentCard.style };
                    scaledStyle.fontSize = `${parseFloat(currentCard.style.fontSize) * scale}px`;
                    scaledStyle.lineHeight = currentCard.style.lineHeight;
                    scaledStyle.letterSpacing = `${parseFloat(currentCard.style.letterSpacing) * scale}px`;
                    Object.assign(textEl.style, scaledStyle);
                    textWrapper.style.transform = `translate(${currentCard.layout.text.x * scale}px, ${currentCard.layout.text.y * scale}px) scale(${currentCard.layout.text.scale || 1}) rotate(${currentCard.layout.text.angle || 0}deg)`;
                    textEl.innerHTML = '';
                    const hasCustomSequence = currentCard.animationSequence && currentCard.animationSequence.length > 0;
                    if (hasCustomSequence) { (currentCard.segments || []).forEach(segment => { if (t >= segment.startTime) { const p = document.createElement('p'); p.textContent = segment.text || ' '; p.style.margin = 0; textEl.appendChild(p); } }); } else { currentCard.text.split('\n').forEach(line => { const p = document.createElement('p'); p.textContent = line || ' '; p.style.margin = 0; textEl.appendChild(p); }); }
                    const applyAnimation = (el, anims, duration, time) => { const baseTransform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY') && !s.startsWith('scale')).join(' '); el.style.opacity = 1; el.style.transform = baseTransform; const inDuration = anims.in.duration; const outStartTime = duration - anims.out.duration; let progress, newTransform = ''; if (time < inDuration && anims.in.name !== 'none') { progress = Math.min(1, time / inDuration); if(anims.in.name === 'fadeIn') el.style.opacity = progress; if(anims.in.name === 'slideInUp') newTransform = ` translateY(${(1 - progress) * 50 * scale}px)`; if(anims.in.name === 'zoomIn') { el.style.opacity = progress; newTransform = ` scale(${0.8 + 0.2 * progress})`; } } else if (time >= outStartTime && anims.out.name !== 'none') { progress = Math.min(1, (time - outStartTime) / anims.out.duration); if(anims.out.name === 'fadeOut') el.style.opacity = 1 - progress; if(anims.out.name === 'slideOutDown') newTransform = ` translateY(${progress * 50 * scale}px)`; if(anims.out.name === 'zoomOut') { el.style.opacity = 1 - progress; newTransform = ` scale(${1 - 0.2 * progress})`; } } el.style.transform = `${baseTransform} ${newTransform}`; };
                    applyAnimation(textWrapper, currentCard.animations.text, currentCard.duration, t);
                }, projectData, card, timeInCard, 1080 / projectData.renderMetadata.sourceWidth);

                const framePath = path.join(overlayFramesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                await page.screenshot({ path: framePath, omitBackground: true });
                frameCount++;
            }
            totalDurationForFrames += card.duration;
        }
        await browser.close();
        console.log(`[${renderId}] Pass 1: 투명 오버레이 프레임 캡처 완료 (${frameCount}개)`);
        
        // ==========================================================
        // 미디어 파일 다운로드 및 배경 비디오 생성
        // ==========================================================
        const mediaClips = [];
        let accumulatedTime = 0;
        for (const [index, card] of projectData.scriptCards.entries()) {
            if (card.media.url) {
                const isBase64 = card.media.url.startsWith('data:');
                const fileBuffer = isBase64 ? Buffer.from(card.media.url.split(',')[1], 'base64') : await (await fetch(card.media.url)).buffer();
                const fileExtension = isBase64 ? card.media.url.match(/data:image\/(.+);/)[1] : path.extname(new URL(card.media.url).pathname).substring(1);
                
                let inputPath = path.join(mediaDir, `media_${index}.${fileExtension}`);
                await fs.writeFile(inputPath, fileBuffer);
                
                // 이미지/GIF를 카드 길이만큼의 비디오로 변환
                if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExtension.toLowerCase())) {
                    const videoClipPath = path.join(mediaDir, `clip_${index}.mp4`);
                    const command = `ffmpeg -i "${inputPath}" -t ${card.duration} -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:-1:-1:color=black,format=yuv420p" -y "${videoClipPath}"`;
                    await new Promise((resolve, reject) => exec(command, (err) => err ? reject(err) : resolve()));
                    inputPath = videoClipPath;
                }
                
                let showTime = 0;
                if(card.media.showOnSegment > 1) {
                    const targetSegmentIndex = card.media.showOnSegment - 2;
                    if (card.segments && card.segments[targetSegmentIndex]) {
                        showTime = card.segments[targetSegmentIndex].startTime;
                    }
                }
                mediaClips.push({ path: inputPath, startTime: accumulatedTime + showTime, endTime: accumulatedTime + card.duration });
            }
            accumulatedTime += card.duration;
        }
        
        const backgroundVideoPath = path.join(mediaDir, 'background.mp4');
        const blackBgCommand = `ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=${totalDurationForFrames} -pix_fmt yuv420p -y "${backgroundVideoPath}"`;
        await new Promise((resolve, reject) => exec(blackBgCommand, (err) => err ? reject(err) : resolve()));

        let currentVideo = backgroundVideoPath;
        for (const [i, clip] of mediaClips.entries()) {
            const nextVideo = path.join(mediaDir, `temp_${i}.mp4`);
            const overlayCommand = `ffmpeg -i "${currentVideo}" -i "${clip.path}" -filter_complex "[0:v][1:v] overlay=0:0:enable='between(t,${clip.startTime},${clip.endTime})'" -y "${nextVideo}"`;
            await new Promise((resolve, reject) => exec(overlayCommand, (err) => err ? reject(err) : resolve()));
            currentVideo = nextVideo;
        }
        const baseVideoPath = currentVideo;
        console.log(`[${renderId}] 배경 비디오 생성 완료`);
        
        // ==========================================================
        // 오디오 믹싱
        // ==========================================================
        const audioTracks = [];
        let currentTime = 0;
        if (projectData.globalBGM && projectData.globalBGM.url) {
            try { const response = await fetch(projectData.globalBGM.url); const path = `${audioDir}/bgm.mp3`; await fs.writeFile(path, await response.buffer()); audioTracks.push({ type: 'bgm', path, volume: projectData.globalBGM.volume || 0.3 }); } catch (e) { console.error('BGM 다운로드 실패:', e); }
        }
        for (const [index, card] of projectData.scriptCards.entries()) {
            if (card.audioUrl) { try { const ttsPath = `${audioDir}/tts_${index}.mp3`; const base64Data = card.audioUrl.split(',')[1]; await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64')); audioTracks.push({ type: 'effect', path: ttsPath, time: currentTime, volume: card.ttsVolume || 1.0 }); } catch (e) { console.error('TTS 파일 저장 실패:', e); } }
            if (card.sfxUrl) { try { const response = await fetch(card.sfxUrl); const sfxPath = `${audioDir}/sfx_${index}.mp3`; await fs.writeFile(sfxPath, await response.buffer()); audioTracks.push({ type: 'effect', path: sfxPath, time: currentTime, volume: card.sfxVolume || 1.0 }); } catch (e) { console.error('SFX 다운로드 실패:', e); } }
            currentTime += card.duration;
        }

        if (audioTracks.length > 0) {
            const inputClauses = audioTracks.map(t => `-i "${t.path}"`).join(' ');
            let filterComplex = '';
            if (audioTracks.length > 1) { const outputStreams = []; audioTracks.forEach((track, i) => { let stream = `[${i}:a]`; if (track.type === 'bgm') { stream += `volume=${track.volume}[a${i}]`; } else { stream += `volume=${track.volume},adelay=${track.time * 1000}|${track.time * 1000}[a${i}]`; } filterComplex += stream; outputStreams.push(`[a${i}]`); if(i < audioTracks.length - 1) filterComplex += ';'; }); filterComplex += `;${outputStreams.join('')}amix=inputs=${outputStreams.length}:duration=longest`; } else { const track = audioTracks[0]; filterComplex = `[0:a]volume=${track.volume}`; }
            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
            await new Promise((resolve, reject) => exec(mixCommand, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout)));
        }
        console.log(`[${renderId}] 오디오 믹싱 완료`);

        // ==========================================================
        // PASS 2: FFmpeg로 배경 비디오, 오버레이, 오디오 최종 합성
        // ==========================================================
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';

        const finalFfmpegCommand = `ffmpeg -i "${baseVideoPath}" -i "${overlayFramesDir}/frame_%06d.png" ${audioInput} -filter_complex "[0:v][1:v]overlay=0:0[v]" -map "[v]" ${hasAudio ? '-map 2:a' : ''} -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -shortest -y "${outputVideoPath}"`;

        console.log(`[${renderId}] Pass 2: 최종 영상 합성 실행`);
        await new Promise((resolve, reject) => exec(finalFfmpegCommand, (err, stdout, stderr) => err ? reject(new Error(stderr)) : resolve(stdout)));
        console.log(`[${renderId}] 최종 영상 합성 완료`);

        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) console.error('파일 다운로드 오류:', err);
            await fs.remove(tempDir);
            console.log(`[${renderId}] 임시 폴더 삭제 및 작업 완료`);
        });

    } catch (error) {
        console.error(`[${renderId}] 렌더링 중 오류 발생:`, error);
        if (browser) await browser.close();
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        if (!res.headersSent) res.status(500).json({ success: false, message: '영상 생성 중 오류가 발생했습니다.' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 ${PORT} 포트에서 실행되었습니다!`);
    console.log(`=============================================`);
});
// ================== [server.js 전체 코드 끝] ====================
