// ===============================================
//  worker.js (진짜진짜 최종 완성 버전)
// ===============================================
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const os = require('os');
const { PubSub } = require('@google-cloud/pubsub');
const { Storage } = require('@google-cloud/storage');
const { Firestore } = require('@google-cloud/firestore');

const GCP_PROJECT_ID = 'sunsak-tool-gcp';
const pubSubClient = new PubSub({ projectId: GCP_PROJECT_ID });
const storage = new Storage({ projectId: GCP_PROJECT_ID });
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });
const OUTPUT_BUCKET_NAME = 'sunsak-output-videos';
const SUBSCRIPTION_NAME = 'sunsak-render-jobs-sub';

async function updateJobStatus(jobId, status, message, progress = null) {
    const jobRef = firestore.collection('renderJobs').doc(jobId);
    const updateData = { status, message, updatedAt: new Date() };
    if (progress !== null) updateData.progress = progress;
    await jobRef.set(updateData, { merge: true });
    console.log(`[${jobId}] 상태: ${status} - ${message} (${progress || ''}%)`);
}

async function renderVideo(jobId, projectData) {
    const fps = 30;
    const tempDir = path.join(os.tmpdir(), jobId);
    const framesDir = path.join(tempDir, 'frames');
    const audioDir = path.join(tempDir, 'audio');
    const finalAudioPath = path.join(tempDir, 'final_audio.aac');
    const outputVideoPath = path.join(tempDir, 'output.mp4');

    try {
        await fs.ensureDir(framesDir);
        await fs.ensureDir(audioDir);

        await updateJobStatus(jobId, 'processing', '프레임 이미지 저장 중...', 20);
        await Promise.all(projectData.frameImages.map((dataUrl, i) => {
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
            const framePath = path.join(framesDir, `frame_${String(i).padStart(6, '0')}.png`);
            return fs.writeFile(framePath, base64Data, 'base64');
        }));

        await updateJobStatus(jobId, 'processing', '오디오 트랙 처리 중...', 55);
        const audioRenderPromise = (async () => {
            const audioFiles = await Promise.all(projectData.audioTracks.map(async (track, index) => {
                if (!track.audioUrl) return null;
                const audioPath = path.join(audioDir, `audio_${index}.mp3`);
                const base64Data = track.audioUrl.split(',')[1];
                await fs.writeFile(audioPath, Buffer.from(base64Data, 'base64'));
                return { path: audioPath, duration: track.duration };
            }));

            const validAudioFiles = audioFiles.filter(f => f);
            if (validAudioFiles.length === 0) return;
            
            const inputClauses = validAudioFiles.map(f => `-i "${f.path}"`).join(' ');
            let complexFilter = '';
            let outputs = '';
            let currentTime = 0;

            validAudioFiles.forEach((file, i) => {
                complexFilter += `[${i}:a]adelay=${currentTime * 1000}|${currentTime * 1000}[a${i}];`;
                outputs += `[a${i}]`;
                currentTime += file.duration;
            });

            complexFilter += `${outputs}amix=inputs=${validAudioFiles.length}`;

            const mixCommand = `ffmpeg ${inputClauses} -filter_complex "${complexFilter}" -y "${finalAudioPath}"`;
            
            await new Promise((resolve, reject) => exec(mixCommand, (err, stdout, stderr) => {
                if (err) return reject(new Error(`오디오 믹싱 오류: ${stderr}`));
                resolve(stdout);
            }));
        })();
        await audioRenderPromise;

        await updateJobStatus(jobId, 'processing', '최종 영상 합성 중...', 80);
        const hasAudio = await fs.pathExists(finalAudioPath);
        const audioInput = hasAudio ? `-i "${finalAudioPath}"` : '';
        const ffmpegCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%06d.png" ${audioInput} -c:v libx264 -crf 18 -preset slow -vf "scale=1080:1920,setsar=1:1,format=yuv420p,colormatrix=srgb:bt709" -c:a aac -movflags +faststart ${hasAudio ? '-shortest' : ''} "${outputVideoPath}"`;
        await new Promise((resolve, reject) => exec(ffmpegCommand, (err, stdout, stderr) => {
            if (err) return reject(new Error(`FFMPEG 최종 합성 오류: ${stderr}`));
            resolve(stdout);
        }));

        await updateJobStatus(jobId, 'processing', '영상 업로드 중...', 95);
        const destination = `videos/${jobId}/${projectData.projectSettings?.title || 'sunsak-video'}.mp4`;
        await storage.bucket(OUTPUT_BUCKET_NAME).upload(outputVideoPath, { destination });
        const videoUrl = `https://storage.googleapis.com/${OUTPUT_BUCKET_NAME}/${destination}`;
        
        await updateJobStatus(jobId, 'completed', '영상 제작이 완료되었습니다.', 100);
        await firestore.collection('renderJobs').doc(jobId).set({ videoUrl, completedAt: new Date() }, { merge: true });
    } catch (error) {
        console.error(`[${jobId}] 렌더링 워커 오류:`, error.stack);
        await updateJobStatus(jobId, 'failed', `치명적 오류: ${error.message}`);
    } finally {
        if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
        console.log(`[${jobId}] 임시 파일 정리 완료`);
    }
}

async function listenForMessages() {
    const subscription = pubSubClient.subscription(SUBSCRIPTION_NAME);
    const messageHandler = async (message) => {
        try {
            const { jobId, projectData } = JSON.parse(message.data);
            await renderVideo(jobId, projectData);
            message.ack();
        } catch (error) {
            console.error('[Pub/Sub] 메시지 처리 오류:', error.stack);
            message.ack();
        }
    };
    subscription.on('message', messageHandler);
    subscription.on('error', (error) => console.error(`[Pub/Sub] 리스너 오류:`, error));
    console.log(`Pub/Sub 구독(${SUBSCRIPTION_NAME}) 수신 대기 중...`);
}

const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.status(200).send('SunsakTool Worker is alive.'));
app.listen(PORT, () => {
  console.log(`워커 Health Check 서버 ${PORT} 포트에서 실행 중.`);
  listenForMessages();
});
