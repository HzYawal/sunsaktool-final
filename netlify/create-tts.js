// 파일 경로: netlify/functions/create-tts.js

// Netlify 서버에서 외부 API를 호출하기 위해 'node-fetch' 라이브러리를 가져옵니다.
// package.json에 이 라이브러리가 등록되어 있어야 합니다.
const fetch = require('node-fetch');

// Netlify Function의 핵심 핸들러 함수입니다.
exports.handler = async (event) => {
  // 프론트엔드에서 보낸 요청이 POST 방식이 아니면 에러를 반환합니다.
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405, // Method Not Allowed
      body: JSON.stringify({ error: 'POST 요청만 허용됩니다.' }),
    };
  }

  try {
    // 1. Netlify에 설정된 환경 변수에서 ElevenLabs API 키를 안전하게 불러옵니다.
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        // API 키가 설정되지 않은 경우, 서버 로그에만 에러를 남기고 사용자에게는 일반적인 메시지를 보냅니다.
        console.error('ElevenLabs API 키가 서버 환경 변수에 설정되지 않았습니다.');
        throw new Error('TTS 서비스 설정에 오류가 발생했습니다.');
    }

    // 2. 요청 본문(body)에서 음성으로 변환할 'text'를 추출합니다.
    const { text } = JSON.parse(event.body);
    if (!text || text.trim() === '') {
      return {
        statusCode: 400, // Bad Request
        body: JSON.stringify({ error: '음성으로 변환할 텍스트가 비어있습니다.' }),
      };
    }

    // 3. ElevenLabs API에 요청을 보낼 정보를 설정합니다.
    const VOICE_ID = 'Xb2VevYIhMxiJ1eB2YtU'; // 사용자님이 지정한 커스텀 목소리 ID
    const API_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

    // 4. ElevenLabs API 호출
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY, // 헤더에 API 키를 포함하여 인증
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2', // 한국어 지원 모델
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    // 5. API 응답 처리
    if (!response.ok) {
      // ElevenLabs에서 에러가 발생한 경우, 그 내용을 분석하여 프론트엔드에 전달합니다.
      const errorData = await response.json();
      console.error('ElevenLabs API Error:', errorData);
      throw new Error(`음성 생성 실패: ${errorData.detail.message || response.statusText}`);
    }

    // 6. 성공 시, 오디오 데이터를 Base64로 인코딩하여 프론트엔드로 전달
    // ElevenLabs는 오디오 파일을 직접 반환하므로, 프론트의 <audio> 태그가 바로 사용할 수 있는
    // '데이터 URI' 형태로 가공해서 보내줍니다.
    const audioBuffer = await response.buffer();
    const audioBase64 = audioBuffer.toString('base64');
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ audioUrl: audioUrl }), // 기존 프론트 코드가 기대하는 응답 형식
    };

  } catch (error) {
    // 모든 종류의 에러를 여기서 처리합니다.
    console.error('TTS 생성 중 심각한 오류 발생:', error);
    return {
      statusCode: 500, // Internal Server Error
      body: JSON.stringify({ error: error.message || '서버 내부 오류가 발생했습니다.' }),
    };
  }
};
