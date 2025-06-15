// 파일 경로: /netlify/functions/create-tts.js (테스트용 최종 코드)

exports.handler = async (event, context) => {
    
    // CORS Preflight 요청을 가장 먼저 처리합니다.
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

    // POST가 아니면 거부합니다.
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: {'Access-Control-Allow-Origin': '*'}, 
            body: 'Method Not Allowed' 
        };
    }

    // 어떤 요청이 오든, 무조건 성공 메시지와 테스트용 URL을 반환합니다.
    try {
        const testData = {
            message: "서버 기능 호출 성공! (테스트 모드)",
            audioUrl: "https://sunsaktool-final.netlify.app/big-cafe.mp3" // 임시 오디오 파일
        };

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(testData)
        };

    } catch (error) {
        // 이 부분은 실행될 일이 거의 없지만, 만약을 위해 남겨둡니다.
        const errorMessage = "테스트 코드 실행 중 알 수 없는 에러 발생";
        console.error(errorMessage, error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
