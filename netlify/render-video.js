// 파일 경로: /netlify/render-video.js (한글 폰트 및 인코딩 최종 수정본)

const cloudinary = require('cloudinary').v2;

// Netlify 환경 변수에서 Cloudinary 접속 정보를 가져옵니다.
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

exports.handler = async (event) => {
    // CORS Preflight 요청 처리 등 (이전 코드와 동일)
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

        // TTS 음성 파일을 Cloudinary에 업로드
        const audioUploadResult = await cloudinary.uploader.upload(firstScene.audioUrl, {
            resource_type: "video"
        });
        const audioPublicId = audioUploadResult.public_id;
        
        console.log('오디오 업로드 성공:', audioPublicId);

        // ✨ 1. 한글 텍스트를 Cloudinary가 이해하도록 안전하게 인코딩합니다.
        // 텍스트를 먼저 인코딩하고, 특수문자(.)까지 처리합니다.
        const encodedText = encodeURIComponent(firstScene.text).replace(/\./g, '%2E');

        // 2. "작업 지시서" (Transformation)를 수정합니다.
        const videoPublicId = 'white_canvas'; 
        const transformations = [
            // 글자 오버레이
            {
                // ✨ 2. 한글을 지원하는 구글 폰트 'Noto Sans KR'을 사용합니다.
                overlay: {
                    font_family: "Noto Sans KR", // Arial -> Noto Sans KR
                    font_size: 70,
                    font_weight: "bold",
                    // ✨ 3. 안전하게 인코딩된 텍스트를 전달합니다.
                    text: encodedText
                },
                color: "#000000",
                gravity: "center"
            },
            // 오디오 오버레이
            {
                overlay: {
                    public_id: audioPublicId
                },
                flags: "layer_apply"
            },
            // 영상 길이 설정 (오디오 길이에 맞추는 것은 다음 단계)
            {
                duration: "5.0"
            }
        ];
        
        // 작업 지시서대로 영상을 생성하고 URL을 만듭니다.
        const finalVideoUrl = cloudinary.url(videoPublicId, {
            resource_type: 'video',
            transformation: transformations
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
