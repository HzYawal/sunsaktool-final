// 파일 이름: rendering-server/handler.js

// Lambda 함수의 메인 핸들러
module.exports.main = async (event) => {
  try {
    console.log('🎉 렌더링 요청을 성공적으로 받았습니다!');
    const projectData = JSON.parse(event.body);

    // 나중에 이 부분에 진짜 렌더링 코드가 들어갑니다.
    console.log('전달받은 데이터:', projectData.scenes.length, '개의 씬');

    // 성공 응답 반환
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '성공! 서버가 요청을 받았습니다.',
        jobId: `job-${Date.now()}` // 임시 작업 ID
      }),
    };

  } catch (error) {
    console.error('❌ 처리 중 오류 발생:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '서버 처리 실패', error: error.message }),
    };
  }
};
