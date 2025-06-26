// ================== [server.js 최종 완성본 - 생략/중략 없음] ==================
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const cors = require('cors');
const puppeteer = require('puppeteer'); 
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// 구글 TTS API
app.post('/api/create-tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text || !text.trim()) { return res.status(400).json({ error: 'TTS로 변환할 텍스트가 없습니다.' }); }
    const selectedVoice = voice || 'ko-KR-Standard-C';
    const speakingRate = parseFloat(speed) || 1.0; 
    const client = new TextToSpeechClient();
    const ssmlText = `<speak><prosody rate="${speakingRate}">${text}</prosody></speak>`;
    try {
        const request = { input: { ssml: ssmlText }, voice: { languageCode: 'ko-KR', name: selectedVoice }, audioConfig: { audioEncoding: 'MP3' }, };
        const [response] = await client.synthesizeSpeech(request);
        const audioBase64 = response.audioContent.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
        res.json({ audioUrl: audioUrl });
    } catch (error) { console.error('구글 TTS API 호출 중 오류 발생:', error); res.status(500).json({ error: error.message }); }
});

// 영상 렌더링 API (레이아웃, 확대, 회전 완벽 동기화 버전)
app.post('/render-video', async (req, res) => {
    console.log("영상 렌더링 요청 시작 (레이아웃/기능 동기화 버전)");
    const projectData = req.body;
    const fps = 30;
    const renderId = `render_${Date.now()}`;
    
    // Cloud Run 호환을 위해 /tmp 디렉토리 사용
    const tempDir = path.join(os.tmpdir(), renderId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.mp3');
    const outputVideoPath = path.join(tempDir, 'output.mp4');
    let browser;

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);
        console.log(`[${renderId}] 임시 폴더 생성: ${tempDir}`);

        // --- 1. Puppeteer로 비디오 프레임 캡처 ---
        const videoRenderPromise = (async () => {
            console.log(`[${renderId}] Puppeteer 실행`);
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1920 });
            
            const renderTemplateContent = await fs.readFile(path.join(__dirname, 'render_template.html'), 'utf-8');
            await page.setContent(renderTemplateContent, { waitUntil: 'networkidle0' });

            await page.evaluate(async () => {
                const fontPromises = Array.from(document.fonts).map(font => font.load());
                await Promise.all(fontPromises);
            });
            console.log(`[${renderId}] 렌더링 템플릿 및 폰트 로드 완료`);
            
            let frameCount = 0;
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
                    
                    await page.evaluate((project, currentCard, mediaInfo, t) => {
                        const scale = 1080 / project.renderMetadata.sourceWidth;
                        const pSettings = project.projectSettings;
                        
                        // 헤더
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
                        const iconSVG = {
                            back: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`,
                            menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${pSettings.header.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`
                        };
                        headerIconEl.innerHTML = iconSVG[pSettings.header.icon] || '';
                        if (pSettings.header.logo.url) {
                            headerLogoEl.src = pSettings.header.logo.url;
                            headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`;
                            headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`;
                            headerLogoEl.style.display = 'block';
                        } else {
                            headerLogoEl.style.display = 'none';
                        }

                        // 프로젝트 정보
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

                        // 텍스트/미디어 요소
                        const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                        const textEl = document.querySelector('#st-preview-text');
                        const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                        const imageEl = document.querySelector('#st-preview-image');
                        const videoEl = document.querySelector('#st-preview-video');

                        // 텍스트/미디어 레이아웃
                        const scaledStyle = { ...currentCard.style };
                        scaledStyle.fontSize = `${parseFloat(currentCard.style.fontSize) * scale}px`;
                        scaledStyle.lineHeight = currentCard.style.lineHeight;
                        scaledStyle.letterSpacing = `${parseFloat(currentCard.style.letterSpacing) * scale}px`;
                        Object.assign(textEl.style, scaledStyle);
                        
                        // [핵심 수정] 텍스트와 미디어의 모든 transform 값을 정확히 반영
                        textWrapper.style.transform = `translate(${currentCard.layout.text.x * scale}px, ${currentCard.layout.text.y * scale}px) scale(${currentCard.layout.text.scale || 1}) rotate(${currentCard.layout.text.angle || 0}deg)`;

                        let showMedia = false;
                        if(mediaInfo.media && mediaInfo.media.url) {
                            const showOnSegmentIndex = mediaInfo.media.showOnSegment - 1;
                            const showTime = (currentCard.segments[showOnSegmentIndex] || {startTime: 0}).startTime;
                            if (t >= showTime) showMedia = true;
                        }

                        if(showMedia) {
                            mediaWrapper.style.display = 'flex';
                            // [핵심 수정] 미디어의 모든 transform 값을 정확히 반영
                            mediaWrapper.style.transform = `translate(${mediaInfo.layout.x * scale}px, ${mediaInfo.layout.y * scale}px) scale(${mediaInfo.layout.scale || 1}) rotate(${mediaInfo.layout.angle || 0}deg)`;
                             if (mediaInfo.media.type === 'video') {
                                imageEl.style.display = 'none';
                                videoEl.style.display = 'block';
                                videoEl.style.objectFit = mediaInfo.media.fit;
                                if (videoEl.src !== mediaInfo.media.url) videoEl.src = mediaInfo.media.url;
                                videoEl.currentTime = (mediaInfo.media.startTime || 0) + t;
                            } else {
                                videoEl.style.display = 'none';
                                imageEl.style.display = 'block';
                                imageEl.style.objectFit = mediaInfo.media.fit;
                                if (imageEl.src !== mediaInfo.media.url) imageEl.src = mediaInfo.media.url;
                            }
                        } else {
                            mediaWrapper.style.display = 'none';
                        }
                        
                        // 텍스트 내용 적용
                        textEl.innerHTML = '';
                        const hasCustomSequence = currentCard.animationSequence && currentCard.animationSequence.length > 0;
                        if (hasCustomSequence) {
                            (currentCard.segments || []).forEach(segment => {
                                if (t >= segment.startTime) {
                                    const p = document.createElement('p');
                                    p.textContent = segment.text || ' ';
                                    p.style.margin = 0;
                                    textEl.appendChild(p);
                                }
                            });
                        } else {
                            currentCard.text.split('\n').forEach(line => {
                                const p = document.createElement('p');
                                p.textContent = line || ' ';
                                p.style.margin = 0;
                                textEl.appendChild(p);
                            });
                        }

                        // 애니메이션 적용
                        const applyAnimation = (el, anims, duration, time) => {
                            const baseTransform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY') && !s.startsWith('scale')).join(' ');
                            el.style.opacity = 1;
                            el.style.transform = baseTransform;

                            const inDuration = anims.in.duration;
                            const outStartTime = duration - anims.out.duration;
                            let progress, newTransform = '';
                            
                            if (time < inDuration && anims.in.name !== 'none') {
                                progress = Math.min(1, time / inDuration);
                                if(anims.in.name === 'fadeIn') el.style.opacity = progress;
                                if(anims.in.name === 'slideInUp') newTransform = ` translateY(${(1 - progress) * 50 * scale}px)`;
                                if(anims.in.name === 'zoomIn') { el.style.opacity = progress; newTransform = ` scale(${0.8 + 0.2 * progress})`; }
                            } else if (time >= outStartTime && anims.out.name !== 'none') {
                                progress = Math.min(1, (time - outStartTime) / anims.out.duration);
                                if(anims.out.name === 'fadeOut') el.style.opacity = 1 - progress;
                                if(anims.out.name === 'slideOutDown') newTransform = ` translateY(${progress * 50 * scale}px)`;
                                if(anims.out.name === 'zoomOut') { el.style.opacity = 1 - progress; newTransform = ` scale(${1 - 0.2 * progress})`; }
                            }
                            el.style.transform = `${baseTransform} ${newTransform}`;
                        };
                        
                        applyAnimation(textWrapper, currentCard.animations.text, currentCard.duration, t);
                        if(showMedia) applyAnimation(mediaWrapper, mediaInfo.animations, currentCard.duration, t);

                    }, projectData, card, mediaToRender, timeInCard);

                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                }
                if (currentPersistentMedia && currentPersistentMedia.endCardId === card.id) currentPersistentMedia = null;
            }
            await browser.close();
            console.log(`[${renderId}] 프레임 캡처 완료 (${frameCount}개)`);
        })();
        
        // --- 2. 오디오 트랙 생성 및 믹싱 ---
        const audioRenderPromise = (async () => {
            const audioTracks = [];
            let currentTime = 0;

            if (projectData.globalBGM && projectData.globalBGM.url) {
                try {
                    const response = await fetch(projectData.globalBGM.url);
                    const path = `${audioDir}/bgm.mp3`;
                    await fs.writeFile(path, await response.buffer());
                    audioTracks.push({ type: 'bgm', path, volume: projectData.globalBGM.volume || 0.3 });
                } catch (e) { console.error('BGM 다운로드 실패:', e); }
            }
            for (const [index, card] of projectData.scriptCards.entries()) {
                if (card.audioUrl && card.audioUrl.startsWith('data:audio/')) {
                    try {
                        const ttsPath = `${audioDir}/tts_${index}.mp3`;
                        const base64Data = card.audioUrl.split(',')[1];
                        await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64'));
                        audioTracks.push({ type: 'effect', path: ttsPath, time: currentTime, volume: card.ttsVolume || 1.0 });
                    } catch (e) { console.error('TTS Base64 파일 저장 실패:', e); }
                }
                if (card.sfxUrl) {
                    try {
                        const response = await fetch(card.sfxUrl);
                        const sfxPath = `${audioDir}/sfx_${index}.mp3`;
                        await fs.writeFile(sfxPath, await response.buffer());
                        audioTracks.push({ type: 'effect', path: sfxPath, time: currentTime, volume: card.sfxVolume || 1.0 });
                    } catch (e) { console.error('SFX 다운로드 실패:', e); }
                }
                currentTime += card.duration;
            }
            if (audioTracks.length === 0) {
                console.log(`[${renderId}] 오디오 트랙 없음, 오디오 믹싱 건너뜀`);
                return;
            }

            const inputClauses = audioTracks.map(t => `-i "${t.path}"`).join(' ');
            let filterComplex = '';

            if (audioTracks.length > 1) {
                const outputStreams = [];
                audioTracks.forEach((track, i) => {
                    let stream = `[${i}:a]`;
                    if (track.type === 'bgm') {
                        stream += `volume=${track.volume}[a${i}]`;
                    } else {
                        stream += `volume=${track.volume},adelay=${track.time * 1000}|${track.time * 1000}[a${i}]`;
                    }
                    filterComplex += stream;
                    outputStreams.push(`[a${i}]`);
                    if(i < audioTracks.length - 1) filterComplex += ';';
                });
                filterComplex += `;${outputStreams.join('')}amix=inputs=${outputStreams.length}:duration=longest`;
            } else {
                const track = audioTracks[0];
                filterComplex = `[0:a]volume=${track.volume}`;
            }

            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
            
            console.log(`[${renderId}] 오디오 믹싱 실행`);
            await new Promise((resolve, reject) => {
                exec(mixCommand, (error, stdout, stderr) => {
                    if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(new Error(stderr)); }
                    resolve(stdout);
                });
            });
            console.log(`[${renderId}] 최종 오디오 파일 생성 완료`);
        })();

        // --- 3. 비디오와 오디오 최종 합성 ---
        await Promise.all([videoRenderPromise, audioRenderPromise]);
        
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        
        console.log(`[${renderId}] 최종 영상 합성 실행`);
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err, stdout, stderr) => { if (err) { console.error('FFMPEG 최종 합성 오류:', stderr); reject(new Error(stderr)); } else resolve(stdout); }));
        console.log(`[${renderId}] 최종 영상 합성 완료`);

        res.download(outputVideoPath, `${projectData.projectSettings.project.title || 'sunsak-video'}.mp4`, async (err) => {
            if (err) console.error('파일 다운로드 오류:', err);
            await fs.remove(tempDir);
            console.log(`[${renderId}] 임시 폴더 삭제 및 작업 완료`);
        });

    } catch (error) {
        console.error(`[${renderId}] 렌더링 프로세스 전체에서 오류 발생:`, error);
        if (browser) await browser.close();
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        if (!res.headersSent) res.status(500).json({ success: false, message: '영상 생성 중 심각한 오류가 발생했습니다.' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 ${PORT} 포트에서 실행되었습니다!`);
    console.log(`=============================================`);
});
