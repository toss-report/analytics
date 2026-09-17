나만의 랜딩페이지 - 배포 방법
================================

1) 이 폴더 전체를 깃허브(GitHub) 새 저장소에 업로드하세요.
   - 깃허브 웹사이트에서 New repository 생성 → "uploading an existing file"로 이 폴더 안의 파일/폴더를 전부 드래그해서 올리면 됩니다.

2) 클라우드페어(Cloudflare)에서 그 저장소를 연결하세요.
   - Cloudflare 대시보드 → Workers & Pages → Create → 저장소 선택(Import) → 화면에 나오는 순서대로 진행
   - Deploy command는 기본값(npx wrangler deploy) 그대로 두면 됩니다. wrangler.toml이 함께 올라가서 자동으로 인식돼요.
   - 화면에 "Path"(또는 Root directory) 칸이 있으면, 이 폴더를 올린 저장소 안에서 이 폴더가 있는 경로를 넣어주세요.

3) 배포가 끝나면 발급된 주소(예: https://내사이트이름.workers.dev)가 나만의 랜딩페이지 주소예요.

4) 리포트 배포(관리자) 기능을 쓰려면, 배포 후 클라우드페어 대시보드에서 딱 두 가지를 한 번만 더 해주세요.
   4-1) 프로젝트 화면 → Bindings(또는 Settings → Bindings) → KV Namespace 추가
        - 없으면 새 KV 네임스페이스를 하나 만들고, 이름은 REPORTS로, 이 프로젝트에 연결하세요.
        - 또는 wrangler.toml 파일을 열어 REPLACE_ME_WITH_YOUR_KV_NAMESPACE_ID 부분을 실제 KV 네임스페이스 ID로 바꾼 뒤 다시 올려도 됩니다.
   4-2) 프로젝트 화면 → Settings → Variables and Secrets → Add → 타입은 "Secret"으로, 이름은 ADMIN_PASSWORD, 값은 편집기에서 정하셨던 그 비밀번호를 입력
   4-3) 저장하면 자동으로 다시 배포돼요. 잠시 후 내 주소 뒤에 /admin 을 붙여서(예: https://내사이트이름.workers.dev/admin) 접속하면 관리자 로그인 화면이 나와요.

   * 관리자 페이지에서 만든 링크(https://내사이트이름.workers.dev/r/...)를 취소고객/기고객에게 보내주시면, 리포트 안의 "보장가이드 확인하기" 버튼이 자동으로 내 랜딩페이지로 연결돼요.

내용을 다시 고치고 싶으면, 이 편집기로 돌아와서 수정 후 다시 다운로드하고 같은 저장소에 덮어써서 올리면 됩니다.
