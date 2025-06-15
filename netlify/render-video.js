// 파일 경로: /netlify/render-video.js (SDK 공식 사용법 최종 버전)

const cloudinary = require('cloudinary').v2;

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
        };
    }
    if (event.httpMethod !== 'POST') { return { statusCode: 405, headers: {'Access-Control-Allow-Origin': '*'}, body: 'Method Not Allowed' }; }

    try {
        const projectData = JSON.parse(event.body);
        const firstScene = projectData.scenes[0];
        if (!firstScene) throw new Error("출력할 씬이 없습니다.");

        // 1. TTS 오디오를 Cloudinary에 업로드하고, 그 파일의 고유 ID를 가져옵니다.
        const audioUploadResult = await cloudinary.uploader.upload(firstScene.audioUrl, {
            resource_type: "video",
            public_id: `sunsaktool_audio_${Date.now()}`
        });
        const audioPublicId = audioUploadResult.public_id;
        
        console.log('오디오 업로드 성공:', audioPublicId);
        
        // 2. ✨✨✨ 가장 중요한 부분 ✨✨✨
        // 이제 복잡한 URL 문자열 대신, 깔끔한 객체(Object) 형태로 작업 지시서를 만듭니다.
        // Cloudinary 라이브러리가 이 객체를 보고 모든 한글과 특수문자를 알아서 안전하게 처리합니다.
        const transformations = [
            // 첫 번째 지시: 1080x1920 크기의 흰색 배경을 만듭니다.
            {
                width: 1080,
                height: 1920,
                background: "white",
                crop: "pad"
            },
            // 두 번째 지시: 그 배경 위에 텍스트를 입힙니다.
            {
                overlay: {
                    font_family: "Noto Sans KR",
                    font_size: 70,
                    font_weight: "bold",
                    text: firstScene.text // 순수한 텍스트를 그대로 전달합니다.
                },
                color: "black",
                gravity: "center"
            }
        ];
        
        // 3. ✨✨✨ 두 번째로 중요한 부분 ✨✨✨
        // 이제 'white_canvas' 같은 가짜 파일이 아니라,
        // 방금 올린 '오디오 파일'을 기준으로 영상을 만듭니다.
        // 오디오 길이에 맞춰 영상 길이가 자동으로 조절됩니다.
        const finalVideoUrl = cloudinary.url(audioPublicId, {
            resource_type: 'video',
            transformation: transformations,
            sign_url: true 
        });

        console.log('최종 영상 URL 생성 성공:', finalVideoUrl);

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
