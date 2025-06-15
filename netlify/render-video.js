// 파일 경로: /netlify/render-video.js (Base64 인코딩 최종 버전)

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

        const audioUploadResult = await cloudinary.uploader.upload(firstScene.audioUrl, {
            resource_type: "video",
            public_id: `sunsaktool_audio_${Date.now()}`
        });
        const audioPublicId = audioUploadResult.public_id;
        
        console.log('오디오 업로드 성공:', audioPublicId);

        // ✨ 1. 텍스트를 Base64로 인코딩하고, URL에 사용 가능하도록 안전하게 만듭니다.
        const base64Text = Buffer.from(firstScene.text, 'utf-8').toString('base64');
        const urlSafeBase64Text = base64Text.replace(/\+/g, '-').replace(/\//g, '_');

        const videoPublicId = 'white_canvas'; 
        const transformations = [
            {
                // ✨ 2. Base64로 인코딩된 텍스트를 전달합니다.
                // 폰트 이름의 공백은 언더스코어(_)로 변경해야 합니다.
                overlay: {
                    font_family: "Noto_Sans_KR",
                    font_size: 70,
                    font_weight: "bold",
                    text: `!${urlSafeBase64Text}!` // !..._! 는 Base64를 의미하는 Cloudinary 문법
                },
                encoding: "base64", // 인코딩 타입을 명시
                color: "black",
                gravity: "center"
            },
            {
                overlay: `audio:${audioPublicId}`
            },
            {
                duration: "5.0"
            }
        ];
        
        const finalVideoUrl = cloudinary.url(videoPublicId, {
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
