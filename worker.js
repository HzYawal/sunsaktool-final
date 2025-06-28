// ===============================================
//  worker.js (진짜 최종 완성 버전 - No Playwright)
// ===============================================
console.log('--- 워커 프로세스 시작 ---');

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const os = require('os');
const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

console.log('--- 모든 모듈 로딩 성공! ---');

const GCP_PROJECT_ID = 'sunsak-tool-gcp';
const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
const storage = new Storage({ projectId: GCP_PROJECT_ID });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });
const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

async function updateJobStatus(jobId, status, message, progress = null) {
    const jobRef = firestore.collection('renderJobs').doc(jobId);
    const updateData = { status, message, updatedAt: new Date() };
    if (progress !== null) { updateData.progress = progress; }
    await jobRef.set(updateData, { merge: true });
    console.log(`[${jobId}] 상태 업데이트: ${status} - ${message} (${progress !== null ? progress + '%' : ''})`);
}

async function renderVideo(jobId, projectData) {
    console.log(`[${jobId}] --- [A] renderVideo 함수 진입 (이미지 기반) ---`);
    await updateJobStatus(jobId, 'processing', '렌더링 환경을 설정하고 있습니다.', 15);

    const fps = 30;
    const tempDir = path.join(os.tmpdir(), jobId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.aac');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);
        console.log(`[${jobId}] 임시 디렉토리 생성 완료`);

        await updateJobStatus(jobId, 'processing', '수신된 프레임 이미지를 저장합니다.', 20);
        for (let i = 0; i < projectData.frameImages.length; i++) {
            const dataUrl = projectData.frameImages[i];
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
            const framePath = path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`);
            await fs.writeFile(framePath, base64Data, 'base64');
        }
        console.log(`[${jobId}] 프레임 이미지 저장 완료`);

        await updateJobStatus(jobId, 'processing', '오디오 트랙을 처리하고 있습니다.', 55);
        const audioRenderPromise = (async () => {
            const audioTracks = [];
            let currentTime = 0;
            if (projectData.globalBGM && projectData.globalBGM.url) {
                try {
                    const response = await fetch(projectData.globalBGM.url);
                    const path_1 = `${audioDir}/bgm.mp3`;
                    await fs.writeFile(path_1, await response.buffer());
                    audioTracks.push({ type: 'bgm', path: path_1, volume: projectData.globalBGM.volume || 0.3 });
                } catch (e) { console.error('BGM 다운로드 실패:', e); }
            }
            if (projectData.audioTracks) {
                for (const [index, track] of projectData.audioTracks.entries()) {
                    if (track.audioUrl && track.audioUrl.startsWith('data:audio/')) {
                        try {
                            const ttsPath = `${audioDir}/tts_${index}.mp3`;
                            const base64Data = track.audioUrl.split(',')[1];
                            await fs.writeFile(ttsPath, Buffer.from(base64Data, 'base64'));
                            audioTracks.push({ type: 'effect', path: ttsPath, time: currentTime, volume: track.ttsVolume || 1.0 });
                        } catch (e) { console.error('TTS 파일 저장 실패:', e); }
                    }
                    if (track.sfxUrl) {
                        try {
                            const response = await fetch(track.sfxUrl);
                            const sfxPath = `${audioDir}/sfx_${index}.mp3`;
                            await fs.writeFile(sfxPath, await response.buffer());
                            audioTracks.push({ type: 'effect', path: sfxPath, time: currentTime, volume: track.sfxVolume || 1.0 });
                        } catch (e) { console.error('SFX 다운로드 실패:', e); }
                    }
                    currentTime += track.duration;
                }
            }
            if (audioTracks.length === 0) return;
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
                    if (i < audioTracks.length - 1) filterComplex += ';';
                });
                filterComplex += `;${outputStreams.join('')}amix=inputs=${outputStreams.length}:duration=longest`;
            } else {
                const track = audioTracks[0];
                filterComplex = `[0:a]volume=${track.volume}`;
            }
            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${filterComplex}" -y "${finalAudioPath}"`;
            await new Promise((resolve, reject) => exec(mixCommand, (error, stdout, stderr) => {
                if (error) { console.error('오디오 믹싱 오류:', stderr); return reject(new Error(stderr)); }
                resolve(stdout);
            }));
        })();
        await audioRenderPromise;

        await updateJobStatus(jobId, 'processing', '최종 영상으로 합성하고 있습니다.', 80);
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -vf "scale=1080:1920,setsar=1:1,format=yuv420p,colormatrix=srgb:bt709" -c:a aac -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err, stdout, stderr) => {
            if (err) { console.error('FFMPEG 최종 합성 오류:', stderr); reject(new Error(stderr)); }
            else resolve(stdout);
        }));

        await updateJobStatus(jobId, 'processing', '완성된 영상을 스토리지에 업로드합니다.', 95);
        const destination = `videos/${jobId}/${projectData.projectSettings?.project?.title || 'sunsak-video'}.mp4`;
        await storage.bucket(OUTPUT_BUCKET_NAME).upload(outputVideoPath, { destination });
        const videoUrl = `https://storage.googleapis.com/${OUTPUT_BUCKET_NAME}/${destination}`;
        await updateJobStatus(jobId, 'completed', '영상 제작이 완료되었습니다.', 100);
        await firestore.collection('renderJobs').doc(jobId).set({ videoUrl, completedAt: new Date() }, { merge: true });
        console.log(`[${jobId}] 작업 완료! 최종 영상 URL: ${videoUrl}`);
    } catch (error) {
        console.error(`[${jobId}] 렌더링 워커 오류:`, error.stack);
        await updateJobStatus(jobId, 'failed', `치명적 오류: ${error.message}.`);
    } finally {
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        console.log(`[${jobId}] 임시 파일 정리 완료`);
    }
}

async function listenForMessages() {
    const subscription = pubSubClient.subscription(SUBSCRIPTION_NAME);
    const messageHandler = async (message) => {
        console.log(`[Pub/Sub] 수신된 메시지 ID: ${message.id}`);
        try {
            const { jobId, projectData } = JSON.parse(message.data);
            console.log(`[${jobId}] 렌더링 작업 처리 시작`);
            await renderVideo(jobId, projectData);
            message.ack();
            console.log(`[${jobId}] 메시지 처리 완료 (ack)`);
        } catch (error) {
            console.error('[Pub/Sub] 메시지 처리 중 심각한 오류:', error.stack);
            message.ack();
        }
    };
    subscription.on('message', messageHandler);
    subscription.on('error', (error) => console.error(`[Pub/Sub] 심각한 리스너 오류 발생:`, error));
    console.log(`SunsakTool 렌더링 워커가 Pub/Sub 구독(${SUBSCRIPTION_NAME})을 수신 대기합니다...`);
}

const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.status(200).send('SunsakTool Worker is alive.'));
app.listen(PORT, () => {
  console.log(`워커 Health Check 서버가 ${PORT} 포트에서 실행되었습니다.`);
  listenForMessages();
});
