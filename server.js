const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.static(__dirname));

// TTS 중계 API
app.post('/api/create-tts', async (req, res) => {
    try {
        const response = await fetch('https://sunsaktool-final.netlify.app/.netlify/functions/create-tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        if (!response.ok) throw new Error(`Netlify 함수 오류: ${response.statusText}`);
        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('TTS 중계 오류:', error);
        res.status(500).json({ error: error.message });
    }
});

// 영상 렌더링 API
app.post('/render-video', async (req, res) => {
    console.log("영상 렌더링 요청 시작");
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
        console.log(`[${renderId}] 임시 폴더 생성`);

        const scaleRatio = 1080 / projectData.renderMetadata.sourceWidth;

        const videoRenderPromise = (async () => {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1920 });
            const templatePath = `file://${path.join(__dirname, 'render_template.html')}`;
            await page.goto(templatePath, { waitUntil: 'networkidle0' });
            
            let frameCount = 0;
            let currentPersistentMedia = null; // 미디어 지속 상태 추적

            for (const [cardIndex, card] of projectData.scriptCards.entries()) {
                // 이 카드가 새로운 미디어 지속의 시작점인지 확인
                if (card.media.persistUntilCardId) {
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
                    
                    await page.evaluate((project, currentCard, mediaInfo, t, scale) => {
                        const pSettings = project.projectSettings;
                        
                        // 헤더
                        const headerEl = document.querySelector('.st-preview-header');
                        const headerTitleEl = headerEl.querySelector('.header-title');
                        const headerIconEl = headerEl.querySelector('.header-icon');
                        const headerLogoEl = headerEl.querySelector('.header-logo');
                        const headerLogoContainer = headerEl.querySelector('.header-logo-container');

                        headerEl.style.height = `${65 * scale}px`;
                        headerEl.style.padding = `0 ${15 * scale}px`;
                        headerEl.style.backgroundColor = pSettings.header.backgroundColor;
                        headerTitleEl.innerText = pSettings.header.text;
                        headerTitleEl.style.color = pSettings.header.color;
                        headerTitleEl.style.fontFamily = pSettings.header.fontFamily;
                        headerTitleEl.style.fontSize = `${pSettings.header.fontSize * scale}px`;
                        
                        const iconSVG = {
                            back: `<svg ... stroke="${pSettings.header.color}" ...></svg>`,
                            menu: `<svg ... stroke="${pSettings.header.color}" ...></svg>`
                        };
                        headerIconEl.innerHTML = iconSVG[pSettings.header.icon] || '';
                        
                        if (pSettings.header.logo.url) {
                            headerLogoEl.src = pSettings.header.logo.url;
                            headerLogoEl.style.width = `${pSettings.header.logo.size * scale}px`;
                            headerLogoEl.style.height = `${pSettings.header.logo.size * scale}px`;
                            headerLogoContainer.style.display = 'flex';
                        } else {
                            headerLogoContainer.style.display = 'none';
                        }

                        // 프로젝트 정보
                        const projectInfoTitleEl = document.querySelector('.st-project-info .title');
                        projectInfoTitleEl.innerText = pSettings.project.title;
                        
                        // 텍스트/미디어
                        const textWrapper = document.querySelector('#st-preview-text-container-wrapper');
                        const textEl = document.querySelector('#st-preview-text');
                        const mediaWrapper = document.querySelector('#st-preview-media-container-wrapper');
                        const imageEl = document.querySelector('#st-preview-image');

                        // 텍스트 렌더링
                        textEl.innerHTML = '';
                        (currentCard.segments || []).forEach(segment => {
                            if (t >= segment.startTime) {
                                const p = document.createElement('p'); p.textContent = segment.text || ' '; p.style.margin = 0; textEl.appendChild(p);
                            }
                        });
                        Object.assign(textEl.style, currentCard.style);
                        textWrapper.style.transform = `translate(${currentCard.layout.text.x * scale}px, ${currentCard.layout.text.y * scale}px) scale(${currentCard.layout.text.scale || 1}) rotate(${currentCard.layout.text.angle || 0}deg)`;
                        
                        // 미디어 렌더링
                        let showMedia = false;
                        if(mediaInfo.media.url) {
                            const showOnSegmentIndex = mediaInfo.media.showOnSegment - 1;
                            const showTime = (currentCard.segments[showOnSegmentIndex] || {startTime: 0}).startTime;
                            if (t >= showTime) {
                                showMedia = true;
                            }
                        }

                        if(showMedia) {
                            mediaWrapper.style.display = 'flex';
                            imageEl.src = mediaInfo.media.url;
                            imageEl.style.display = 'block';
                            mediaWrapper.style.transform = `translate(${mediaInfo.layout.x * scale}px, ${mediaInfo.layout.y * scale}px) scale(${mediaInfo.layout.scale || 1}) rotate(${mediaInfo.layout.angle || 0}deg)`;
                        } else {
                            mediaWrapper.style.display = 'none';
                        }

                        // 애니메이션 적용
                        const applyAnimation = (el, anims, duration, time) => {
                            el.style.opacity = 1;
                            el.style.transform = el.style.transform.split(' ').filter(s => !s.startsWith('translateY')).join(' ');

                            const inDuration = anims.in.duration;
                            const outStartTime = duration - anims.out.duration;
                            
                            let progress = 0;
                            if (time < inDuration) {
                                progress = time / inDuration;
                                if(anims.in.name === 'fadeIn') el.style.opacity = progress;
                                if(anims.in.name === 'slideInUp') el.style.transform += ` translateY(${(1 - progress) * 50 * scale}px)`;
                            } else if (time >= outStartTime && anims.out.name !== 'none') {
                                progress = (time - outStartTime) / anims.out.duration;
                                if(anims.out.name === 'fadeOut') el.style.opacity = 1 - progress;
                                if(anims.out.name === 'slideOutDown') el.style.transform += ` translateY(${progress * 50 * scale}px)`;
                            }
                        };
                        
                        applyAnimation(textWrapper, currentCard.animations.text, currentCard.duration, t);
                        if(showMedia) {
                           applyAnimation(mediaWrapper, mediaInfo.animations, currentCard.duration, t);
                        }

                    }, projectData, card, mediaToRender, timeInCard, scaleRatio);

                    const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`);
                    await page.screenshot({ path: framePath });
                    frameCount++;
                }

                // 현재 카드가 지속 미디어의 마지막 카드이면, 지속 상태 해제
                if (currentPersistentMedia && currentPersistentMedia.endCardId === card.id) {
                    currentPersistentMedia = null;
                }
            }
            if (browser) await browser.close();
            console.log(`[${renderId}] 프레임 캡처 완료 (${frameCount}개)`);
        })();
        
        const audioRenderPromise = (async () => {
             // ... (이전의 오디오 처리 로직과 동일)
        })();

        await Promise.all([videoRenderPromise, audioRenderPromise]);
        
        // ... (이하 FFmpeg 최종 합성 및 다운로드 로직은 이전과 동일)

    } catch (error) {
        console.error(`[${renderId}] 렌더링 중 오류 발생:`, error);
        if (browser) await browser.close();
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        if (!res.headersSent) res.status(500).json({ success: false, message: '영상 생성 중 오류가 발생했습니다.' });
    }
});


app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  SunsakTool 서버가 실행되었습니다!`);
    console.log(`  브라우저에서 http://localhost:${PORT} 로 접속하세요.`);
    console.log(`=============================================`);
});
