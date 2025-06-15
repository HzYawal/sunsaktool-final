// 파일 경로: /netlify/render-video.js (문법 수정 최종본)

const { createCanvas, registerFont } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.handler = async (event) => {
    // CORS Preflight 요청 처리
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' };
    }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) {
            throw new Error("출력할 씬(카드)이 없습니다.");
        }

        const width = 1080;
        const height = 1920;
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        
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

        const tempVideoDir = os.tmpdir();
        const outputPath = path.join(tempVideoDir, `output-${Date.now()}.mp4`);

        await new Promise((resolve, reject) => {
            ffmpeg(imagePath)
                .loop(5)
                // ✨ 수정: .setSize() -> .size()
                .size(`${width}x${height}`) 
                // ✨ 수정: .setFps() -> .fps()
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

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                message: "영상 렌더링 작업 요청 성공! (1단계 테스트)",
                note: "실제 영상 파일 생성은 서버 로그를 확인하세요."
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
