const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// FFmpeg 실행 파일의 경로 설정
// serverless-ffmpeg-plugin이 자동으로 /opt/bin/ffmpeg에 FFmpeg를 설치해줍니다.
process.env.FFMPEG_PATH = '/opt/bin/ffmpeg';
process.env.FFPROBE_PATH = '/opt/bin/ffprobe';
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);


// Lambda 함수의 메인 핸들러
module.exports.main = async (event) => {
  try {
    console.log('🎉 렌더링 요청 받음!');
    const projectData = JSON.parse(event.body);

    // 1. 임시 작업 폴더 생성
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sunsak-'));
    console.log(`📂 임시 폴더 생성: ${workingDir}`);

    // 2. 필요한 에셋(이미지, 오디오) 다운로드 (지금은 생략, 다음 단계에서 구현)
    // const downloadedAssets = await downloadAssets(projectData.scenes, workingDir);

    // 3. FFmpeg 명령어 생성 (지금은 테스트용 명령어)
    const outputPath = path.join(workingDir, 'output.mp4');
    const ffmpegCommand = `-f lavfi -i testsrc=size=1080x1920:rate=30:duration=5 -pix_fmt yuv420p ${outputPath} -y`;
    
    console.log('🚀 FFmpeg 실행:', ffmpegCommand);

    // 4. FFmpeg 실행
    await runFFmpeg(ffmpegCommand);
    
    console.log('✅ 영상 렌더링 성공!');

    // 5. 결과 파일 S3에 업로드 (지금은 생략, 다음 단계에서 구현)
    // const videoUrl = await uploadToS3(outputPath);

    // 6. 성공 응답 반환 (지금은 간단한 메시지만)
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '영상 렌더링 성공! (테스트)',
        // videoUrl: videoUrl,
      }),
    };

  } catch (error) {
    console.error('❌ 렌더링 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '렌더링 실패', error: error.message }),
    };
  }
};

// FFmpeg를 실행하고 Promise를 반환하는 헬퍼 함수
function runFFmpeg(command) {
    // 실제로는 ffmpeg() 라이브러리를 사용하거나, exec를 Promise로 감싸야 합니다.
    // 지금은 간단하게 exec로 구현합니다.
    const ffmpegPath = '/opt/bin/ffmpeg'; // Lambda Layer에 설치될 경로
    return new Promise((resolve, reject) => {
        exec(`${ffmpegPath} ${command}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg stderr: ${stderr}`);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}
