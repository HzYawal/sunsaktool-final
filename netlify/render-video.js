// 파일 경로: /netlify/render-video.js (FFmpeg 최종 테스트)

const { createCanvas, registerFont } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') { /* ... CORS 코드 ... */ }
    if (event.httpMethod !== 'POST') { /* ... POST가 아닐 때 ... */ }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) throw new Error("출력할 씬이 없습니다.");

        const width = 1080;
        const height = 1920;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        
        // ... (Canvas 이미지 생성 코드, 이전과 동일) ...
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#000';
        context.font = 'bold 72px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(firstScene.text, width / 2, height / 2);
        
        const tempImageDir = os.tmpdir();
        const imagePath = path.join(tempImageDir, `frame-${Date.now()}.png`);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(imagePath, buffer);

        console.log('이미지 프레임 생성 완료:', imagePath);

        // ✨✨✨ FFmpeg 코드 다시 추가 ✨✨✨
        const tempVideoDir = os.tmpdir();
        const outputPath = path.join(tempVideoDir, `output-${Date.now()}.mp4`);

        await new Promise((resolve, reject) => {
            ffmpeg(imagePath)
                .loop(5)
                .size(`${width}x${height}`)
                .fps(60) 
                .outputOptions('-pix_fmt yuv420p')
                .save(outputPath)
                .on('end', () => {
                    console.log('FFmpeg 처리 완료');
                    fs.unlinkSync(imagePath);
                    resolve();
                })
                .on('error', (err) => {
                    console.error('FFmpeg 에러:', err);
                    fs.unlinkSync(imagePath);
                    reject(err);
                });
        });

        // ✨✨✨ 원래의 성공 메시지로 복구 ✨✨✨
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                message: "영상 렌더링 작업 요청 성공! (FFmpeg 테스트)",
                jobId: `job_${Date.now()}` // 프론트엔드가 기대하는 jobId를 추가
            }),
        };

    } catch (error) {
        console.error('영상 렌더링 핸들러 오류:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};
