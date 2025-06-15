// 파일 경로: /netlify/render-video.js (이중 인코딩 및 폰트 최종 수정본)

const cloudinary = require('cloudinary').v2;

// Netlify 환경 변수에서 Cloudinary 접속 정보를 가져옵니다.
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

exports.handler = async (event) => {
    // CORS Preflight 요청 처리 등은 이전과 동일
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
            resource_type: "video",
            // 오디오 파일의 고유한 이름을 지정하여 중복 업로드를 방지 (선택 사항이지만 추천)
            public_id: `sunsaktool_audio_${Date.now()}`
        });
        const audioPublicId = audioUploadResult.public_id;
        
        console.log('오디오 업로드 성공:', audioPublicId);

        // "작업 지시서" (Transformation) 수정
        const videoPublicId = 'white_canvas'; // Cloudinary에 미리 업로드된 빈 배경 영상 ID
        const transformations = [
            // 글자 오버레이
            {
                // ✨ 1. Cloudinary가 한글 폰트를 잘 인식하도록, 띄어쓰기를 언더스코어(_)로 변경합니다.
                overlay: {
                    font_family: "Noto_Sans_KR",
                    font_size: 70,
                    font_weight: "bold",
                    // ✨ 2. 가장 중요! 인코딩을 하지 않은, 순수한 텍스트를 그대로 전달합니다.
                    // Cloudinary 라이브러리가 알아서 올바르게 인코딩해줄 겁니다.
                    text: firstScene.text 
                },
                color: "black",
                gravity: "center"
            },
            // 오디오 오버레이
            {
                overlay: `audio:${audioPublicId}`
            },
            // 영상 길이 설정 (오디오 길이에 맞추는 것은 다음 단계)
            {
                duration: "5.0"
            }
        ];
        
        // 작업 지시서대로 영상을 생성하고 URL을 만듭니다.
        const finalVideoUrl = cloudinary.url(videoPublicId, {
            resource_type: 'video',
            transformation: transformations,
            // URL이 너무 길어지는 것을 방지하고, 서명을 통해 보안 강화
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
