// 파일 경로: /netlify/render-video.js (Cloudinary 최종 버전)

const cloudinary = require('cloudinary').v2;
const stream = require('stream');

// 1. Netlify 환경 변수에서 Cloudinary 접속 정보를 가져옵니다.
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

exports.handler = async (event) => {
    // CORS Preflight 요청 처리
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
        };
    }
    if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) throw new Error("출력할 씬이 없습니다.");

        // 2. 영상 재료(TTS 음성)를 Cloudinary 창고에 업로드합니다.
        // 지금은 첫 번째 카드의 TTS 음성만 업로드하는 예시입니다.
        const audioUploadResult = await cloudinary.uploader.upload(firstScene.audioUrl, {
            resource_type: "video" // 오디오도 비디오의 일부로 취급하여 업로드
        });
        const audioPublicId = audioUploadResult.public_id;
        
        console.log('오디오 업로드 성공:', audioPublicId);

        // 3. "작업 지시서" (Transformation)를 만듭니다.
        // 1080x1920 크기의 5초짜리 흰색 바탕 영상을 만듭니다.
        const videoPublicId = 'white_canvas'; 
        const transformations = [
            // 글자 오버레이: 첫 번째 카드의 텍스트를 화면 중앙에 입힙니다.
            {
                overlay: {
                    font_family: "Arial",
                    font_size: 80,
                    text: firstScene.text
                },
                color: "#000000",
                gravity: "center"
            },
            // 오디오 오버레이: 방금 올린 TTS 음성을 입힙니다.
            {
                overlay: {
                    public_id: audioPublicId
                },
                flags: "layer_apply"
            }
        ];
        
        // 4. 작업 지시서대로 영상을 생성하고, 완성된 영상의 URL을 만듭니다.
        const finalVideoUrl = cloudinary.url(videoPublicId, {
            resource_type: 'video',
            transformation: transformations,
            // 기본 영상(흰색 바탕)이 5초가 되도록 설정
            duration: "5.0" 
        });

        console.log('최종 영상 URL 생성 성공:', finalVideoUrl);

        // 5. 완성된 영상 URL을 프론트엔드로 전달합니다.
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                message: "Cloudinary 영상 생성 성공!",
                videoUrl: finalVideoUrl 
            }),
        };

    } catch (error) {
        console.error('Cloudinary 렌더링 핸들러 오류:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    }
};
