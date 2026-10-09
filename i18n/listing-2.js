// Store listing translations, Asia: n = name, s = summary, d = dashboard description.
module.exports = {
  ja: {
    n: "Needle for YouTube：チャンネル内検索・再生履歴検索・検索フィルター",
    s: "見た動画を覚えているYouTube検索。チャンネル、再生履歴、「後で見る」を検索して絞り込めます。",
    d: `YouTubeの検索は、あなたがすでに見た動画を知りません。長さや再生回数で絞り込めず、チャンネル内検索はタイトルしか見ません。Needleは、それをYouTubeの検索バーの中でそのまま解決します。

検索バーで
- 入力中に「後で見る」、高く評価した動画、再生履歴が表示されます
- フィルターを入力：<20m、>100k、unwatched、date:week、@チャンネル
- in:playlists で、保存したすべての再生リストを検索
- is:fresh で、すでに表示された動画を隠します
- 検索をフォロー、チャンネルをミュート、すべてのサムネイルに視聴済みを表示

チャンネル内を検索
どのチャンネルでも「動画」タブの針ボタンを押すだけ。読み込み済みの分だけでなく、チャンネルのすべての動画を読み取ります。
- 長さ、再生回数、日付、キーワードで絞り込み
- 見終わった動画を隠す、途中でやめた動画を見つける
- 空いている時間を選ぶと、その時間に収まる動画だけを表示

再生履歴と「後で見る」
- 見始めて最後まで見ていない動画をすべて表示
- チャンネル、長さ、再生回数、視聴した時期で絞り込み
- 確かに見たはずのあの動画を、延々とスクロールせずに見つける

あらゆる再生リストと登録チャンネル
- 自分のものでも他人のものでも、どの再生リストも丸ごと検索して絞り込み
- 登録チャンネルの、未視聴で20分未満の動画だけを表示
- ホームと登録チャンネルで、視聴済みの動画を薄く表示または非表示に

整理・再生・共有
- 「後で見る」と自分の再生リストを整理、高評価をまとめて取り消し、削除された動画も一掃。元に戻す機能と、いつでも戻せるアーカイブ付き
- 絞り込んだ動画を順番に再生、または NotebookLM 用にリンクをコピー
- フィルターをリンクで共有：Needle を入れている人なら、同じリストが同じフィルターで開きます
- キーボード：/ で検索、j と k で移動、x で選択

インサイト
- そのチャンネルで最も伸びる動画の長さと年
- 2つのチャンネルを並べて比較
- チャンネルの普段の再生回数を上回る動画を見つけるウォッチリスト

ログイン不要、アカウント不要、どこにも何も送信しません。すべてブラウザの中で動きます。

拡張機能の画面は英語です。

YouTube および Google とは提携していません。`,
  },

  ko: {
    n: "Needle for YouTube: 채널 내 검색, 시청 기록 검색 및 검색 필터",
    s: "내가 본 영상을 기억하는 YouTube 검색. 채널, 시청 기록, 나중에 볼 동영상을 검색하고 필터링하세요.",
    d: `YouTube 검색은 내가 이미 본 영상을 모르고, 길이나 조회수로 필터링할 수 없으며, 채널 내 검색은 제목만 찾습니다. Needle은 YouTube 검색창 안에서 바로 이 문제를 해결합니다.

검색창에서
- 입력하는 동안 나중에 볼 동영상, 좋아요 표시한 동영상, 시청 기록이 나타납니다
- 필터 입력: <20m, >100k, unwatched, date:week, @채널
- in:playlists 로 저장한 모든 재생목록 검색
- is:fresh 는 이미 보여진 영상을 숨깁니다
- 검색 팔로우, 채널 음소거, 모든 썸네일에 시청 여부 표시

채널 내 검색
아무 채널의 동영상 탭에서 바늘 버튼을 누르세요. 불러온 영상만이 아니라 채널의 모든 영상을 읽습니다.
- 길이, 조회수, 날짜, 키워드로 필터링
- 다 본 영상은 숨기고, 보다 만 영상은 찾기
- 남는 시간을 고르면 그 시간에 맞는 영상만 표시

시청 기록과 나중에 볼 동영상
- 시작했지만 끝까지 보지 않은 모든 영상
- 채널, 길이, 조회수, 시청한 시기로 필터링
- 분명히 봤던 그 영상을 끝없이 스크롤하지 않고 찾기

모든 재생목록과 구독
- 내 것이든 다른 사람 것이든, 어떤 재생목록이든 통째로 검색하고 필터링
- 구독 채널 중 아직 안 본 20분 미만 영상만 보기
- 홈과 구독에서 이미 본 영상을 흐리게 하거나 숨기기

정리, 재생, 공유
- 나중에 볼 동영상과 내 재생목록 정리, 좋아요 한꺼번에 취소, 삭제된 영상 정리까지. 실행 취소와 언제든 되돌릴 수 있는 보관함 제공
- 필터링한 영상을 순서대로 재생하거나 NotebookLM용 링크 복사
- 필터를 링크로 공유: Needle이 있는 사람이라면 같은 목록이 같은 필터로 열립니다
- 키보드: / 검색, j와 k 이동, x 선택

인사이트
- 채널에서 가장 성과가 좋은 영상 길이와 연도
- 두 채널을 나란히 비교
- 채널의 평소 조회수를 넘어서는 영상을 찾아내는 관심 목록

로그인도, 계정도 필요 없고, 어디에도 아무것도 보내지 않습니다. 모두 브라우저 안에서 실행됩니다.

확장 프로그램의 화면은 영어로 되어 있습니다.

YouTube 또는 Google과 제휴 관계가 없습니다.`,
  },

  zh_CN: {
    n: "Needle for YouTube：频道内搜索、观看记录搜索和搜索筛选",
    s: "记得你看过什么的 YouTube 搜索。搜索并筛选频道、观看记录和稍后观看。",
    d: `YouTube 的搜索不知道你已经看过什么，不能按时长或观看次数筛选，频道内搜索也只匹配标题。Needle 直接在 YouTube 的搜索栏里解决这些问题。

在搜索栏中
- 输入时就会显示你的稍后观看、赞过的视频和观看记录
- 输入筛选条件：<20m、>100k、unwatched、date:week、@频道
- in:playlists 搜索你保存的所有播放列表
- is:fresh 隐藏之前已经展示过给你的结果
- 关注一个搜索、屏蔽一个频道，并在每个缩略图上看到你是否看过

搜索一个频道
在任意频道的“视频”标签页点击针形按钮。它会读取频道的全部视频，而不只是已加载的部分。
- 按时长、观看次数、日期和关键词筛选
- 隐藏已看完的视频，或找回看到一半的视频
- 选择你有多少分钟，只显示看得完的视频

你的观看记录和稍后观看
- 所有开始看了却没看完的视频
- 按频道、时长、观看次数或观看时间筛选
- 找到那个你确定看过的视频，不用一直往下翻

任意播放列表和你的订阅
- 搜索并筛选任意播放列表，不管是你的还是别人的，全部内容都能搜
- 你的订阅内容，只看没看过且不到 20 分钟的视频
- 在首页和订阅内容中，把已看过的视频变暗或隐藏

整理、播放、分享
- 整理稍后观看和你自己的播放列表，批量取消赞，清理已删除的视频，支持撤销，还有存档可以随时放回去
- 按顺序播放筛选结果，或为 NotebookLM 复制链接
- 把筛选以链接分享：装了 Needle 的人打开后，看到的是同一个列表和同样的筛选
- 键盘：/ 搜索，j 和 k 移动，x 选择

数据洞察
- 一个频道表现最好的视频时长和年份
- 并排比较两个频道
- 一个关注列表，找出超过频道平时观看次数的视频

无需登录，无需账号，不向任何地方发送任何数据。全部在你的浏览器中运行。

扩展程序界面为英文。

与 YouTube 或 Google 无关联。`,
  },

  zh_TW: {
    n: "Needle for YouTube：頻道內搜尋、觀看記錄搜尋與搜尋篩選",
    s: "記得你看過什麼的 YouTube 搜尋。搜尋並篩選頻道、觀看記錄和「稍後觀看」。",
    d: `YouTube 的搜尋不知道你已經看過什麼，無法依長度或觀看次數篩選，頻道內搜尋也只比對標題。Needle 直接在 YouTube 的搜尋列裡解決這些問題。

在搜尋列中
- 輸入時就會顯示你的「稍後觀看」、喜歡的影片和觀看記錄
- 輸入篩選條件：<20m、>100k、unwatched、date:week、@頻道
- in:playlists 搜尋你儲存的所有播放清單
- is:fresh 會隱藏之前已經出現過的結果
- 追蹤一個搜尋、隱藏一個頻道，並在每個縮圖上看到是否看過

搜尋一個頻道
在任何頻道的「影片」分頁按下針形按鈕。它會讀取頻道的所有影片，而不只是已載入的部分。
- 依長度、觀看次數、日期和關鍵字篩選
- 隱藏已看完的影片，或找回看到一半的影片
- 選擇你有幾分鐘，只顯示看得完的影片

你的觀看記錄和稍後觀看
- 所有開始看了卻沒看完的影片
- 依頻道、長度、觀看次數或觀看時間篩選
- 找到那部你確定看過的影片，不用一直往下捲

任何播放清單和你的訂閱內容
- 搜尋並篩選任何播放清單，不論是你的還是別人的，整份都能搜
- 你的訂閱內容，只看沒看過且不到 20 分鐘的影片
- 在首頁和訂閱內容中，將已看過的影片變暗或隱藏

整理、播放、分享
- 整理「稍後觀看」和你自己的播放清單，大量取消喜歡，清除已刪除的影片，可以復原，還有封存區能隨時放回去
- 依序播放篩選結果，或為 NotebookLM 複製連結
- 把篩選以連結分享：有安裝 Needle 的人打開後，會看到同一份清單和同樣的篩選
- 鍵盤：/ 搜尋，j 和 k 移動，x 選取

數據洞察
- 一個頻道表現最好的影片長度和年份
- 並排比較兩個頻道
- 一份追蹤清單，找出超越頻道平常觀看次數的影片

不需登入，不需帳號，不會傳送任何資料到任何地方。全部在你的瀏覽器中執行。

擴充功能介面為英文。

與 YouTube 或 Google 無關。`,
  },

  id: {
    n: "Needle untuk YouTube: Cari di Channel, Riwayat Tontonan & Filter Pencarian",
    s: "Pencarian YouTube yang tahu apa yang sudah kamu tonton. Cari dan filter channel, riwayat tontonan, dan Tonton Nanti.",
    d: `Pencarian YouTube tidak tahu apa yang sudah kamu tonton, tidak bisa memfilter menurut durasi atau jumlah tayangan, dan pencarian di dalam channel hanya mencocokkan judul. Needle memperbaikinya, langsung di bilah pencarian YouTube.

DI BILAH PENCARIAN
- Video Tonton Nanti, video yang kamu sukai, dan riwayatmu muncul saat kamu mengetik
- Ketik filter: <20m, >100k, unwatched, date:week, @channel
- in:playlists mencari di semua playlist yang kamu simpan
- is:fresh menyembunyikan apa yang sudah pernah ditampilkan kepadamu
- Ikuti sebuah pencarian, bisukan channel, dan lihat video yang sudah kamu tonton di setiap thumbnail

CARI DI DALAM CHANNEL
Tekan tombol jarum di tab Video channel mana pun. Needle membaca semua video channel itu, bukan hanya yang sudah dimuat.
- Filter menurut durasi, tayangan, tanggal, dan kata kunci
- Sembunyikan yang sudah selesai, atau temukan yang kamu tinggalkan di tengah jalan
- Pilih berapa menit waktumu dan lihat hanya video yang muat

RIWAYAT DAN TONTON NANTI
- Semua yang kamu mulai tapi tidak pernah selesai
- Filter menurut channel, durasi, tayangan, atau kapan kamu menontonnya
- Temukan video yang kamu yakin pernah ditonton, tanpa menggulir tanpa akhir

PLAYLIST APA PUN DAN SUBSCRIPTION KAMU
- Cari dan filter playlist apa pun, milikmu atau milik orang lain, seluruhnya
- Subscription kamu, hanya yang belum ditonton dan di bawah 20 menit
- Redupkan atau sembunyikan video yang sudah kamu tonton di Beranda dan Subscription

BERESKAN, PUTAR, BAGIKAN
- Bereskan Tonton Nanti dan playlist milikmu, batalkan suka sekaligus, dan buang video yang sudah dihapus, dengan urungkan dan arsip untuk mengembalikannya
- Putar hasil filtermu secara berurutan, atau salin tautannya untuk NotebookLM
- Bagikan filter sebagai tautan: tautan itu membuka daftar yang sama dengan filter yang sama untuk siapa pun yang punya Needle
- Keyboard: / untuk mencari, j dan k untuk berpindah, x untuk memilih

WAWASAN
- Durasi video dan tahun dengan performa terbaik sebuah channel
- Bandingkan dua channel berdampingan
- Daftar pantauan yang menemukan video yang melampaui tayangan biasa channel-nya

Tanpa login, tanpa akun, tidak ada yang dikirim ke mana pun. Semuanya berjalan di browsermu.

Antarmuka ekstensi ini berbahasa Inggris.

Tidak berafiliasi dengan YouTube atau Google.`,
  },

  ms: {
    n: "Needle untuk YouTube: Carian Saluran, Sejarah Tontonan & Penapis Carian",
    s: "Carian YouTube yang tahu apa yang anda sudah tonton. Cari dan tapis saluran, sejarah tontonan dan Tonton Kemudian.",
    d: `Carian YouTube tidak tahu apa yang anda sudah tonton, tidak boleh menapis mengikut tempoh atau tontonan, dan carian dalam saluran hanya memadankan tajuk. Needle membetulkannya, terus di dalam bar carian YouTube.

DALAM BAR CARIAN
- Tonton Kemudian, video yang anda suka dan sejarah anda muncul semasa anda menaip
- Taip penapis: <20m, >100k, unwatched, date:week, @saluran
- in:playlists mencari dalam setiap senarai main yang anda simpan
- is:fresh menyembunyikan apa yang sudah ditunjukkan kepada anda
- Ikuti carian, senyapkan saluran dan lihat apa yang anda sudah tonton pada setiap lakaran kecil

CARI DALAM SALURAN
Tekan butang jarum pada tab Video mana-mana saluran. Needle membaca setiap video saluran itu, bukan hanya yang sudah dimuatkan.
- Tapis mengikut tempoh, tontonan, tarikh dan kata kunci
- Sembunyikan yang sudah habis ditonton, atau cari yang anda tinggalkan separuh jalan
- Pilih berapa minit yang anda ada dan lihat hanya yang muat

SEJARAH DAN TONTON KEMUDIAN
- Semua yang anda mula tetapi tidak pernah habiskan
- Tapis mengikut saluran, tempoh, tontonan atau bila anda menontonnya
- Cari video yang anda pasti pernah tonton, tanpa menatal tanpa henti

MANA-MANA SENARAI MAIN DAN LANGGANAN ANDA
- Cari dan tapis mana-mana senarai main, milik anda atau orang lain, sepenuhnya
- Langganan anda, hanya yang belum ditonton dan bawah 20 minit
- Malapkan atau sembunyikan video yang sudah anda tonton di Laman Utama dan Langganan

KEMAS, MAIN, KONGSI
- Kemas Tonton Kemudian dan senarai main anda sendiri, batalkan suka secara pukal dan buang video yang telah dipadam, dengan buat asal dan arkib untuk memulangkannya
- Mainkan apa yang anda tapis, mengikut urutan, atau salin pautannya untuk NotebookLM
- Kongsi penapis sebagai pautan: ia membuka senarai yang sama dengan penapis yang sama untuk sesiapa yang ada Needle
- Papan kekunci: / untuk mencari, j dan k untuk bergerak, x untuk memilih

STATISTIK
- Tempoh video dan tahun yang paling berjaya bagi sesebuah saluran
- Bandingkan dua saluran bersebelahan
- Senarai pantau yang mengesan video yang mengatasi tontonan biasa salurannya

Tiada log masuk, tiada akaun, tiada apa-apa dihantar ke mana-mana. Semuanya berjalan dalam pelayar anda.

Antara muka sambungan ini dalam bahasa Inggeris.

Tidak bergabung dengan YouTube atau Google.`,
  },

  vi: {
    n: "Needle cho YouTube: Tìm trong kênh, tìm lịch sử xem và bộ lọc tìm kiếm",
    s: "Tìm kiếm YouTube biết bạn đã xem gì. Tìm và lọc kênh, lịch sử xem và danh sách Xem sau.",
    d: `Tìm kiếm của YouTube không biết bạn đã xem gì, không lọc được theo thời lượng hay lượt xem, và tìm kiếm trong kênh chỉ khớp tiêu đề. Needle khắc phục điều đó ngay trong thanh tìm kiếm của YouTube.

TRONG THANH TÌM KIẾM
- Video Xem sau, video đã thích và lịch sử xem hiện ra ngay khi bạn gõ
- Gõ bộ lọc: <20m, >100k, unwatched, date:week, @kênh
- in:playlists tìm trong mọi danh sách phát bạn đã lưu
- is:fresh ẩn những gì đã từng hiển thị cho bạn
- Theo dõi một tìm kiếm, ẩn một kênh và thấy video đã xem trên mọi hình thu nhỏ

TÌM TRONG MỘT KÊNH
Nhấn nút cây kim ở thẻ Video của bất kỳ kênh nào. Needle đọc mọi video của kênh, không chỉ những video đã tải.
- Lọc theo thời lượng, lượt xem, ngày và từ khóa
- Ẩn video đã xem hết, hoặc tìm lại video bạn bỏ dở
- Chọn số phút bạn có và chỉ xem những gì vừa đủ thời gian

LỊCH SỬ XEM VÀ XEM SAU
- Mọi video bạn đã bắt đầu nhưng chưa xem hết
- Lọc theo kênh, thời lượng, lượt xem hoặc thời điểm bạn xem
- Tìm video bạn chắc chắn đã xem mà không cần cuộn mãi

MỌI DANH SÁCH PHÁT VÀ KÊNH ĐĂNG KÝ
- Tìm và lọc bất kỳ danh sách phát nào, của bạn hay của người khác, toàn bộ
- Kênh đăng ký của bạn, chỉ video chưa xem và dưới 20 phút
- Làm mờ hoặc ẩn video đã xem trên Trang chủ và Kênh đăng ký

DỌN DẸP, PHÁT, CHIA SẺ
- Dọn dẹp Xem sau và danh sách phát của riêng bạn, bỏ thích hàng loạt và xóa các video đã bị gỡ, có hoàn tác và kho lưu trữ để khôi phục
- Phát những gì bạn đã lọc theo thứ tự, hoặc sao chép liên kết cho NotebookLM
- Chia sẻ bộ lọc bằng liên kết: ai có Needle cũng mở được đúng danh sách đó với đúng bộ lọc đó
- Bàn phím: / để tìm, j và k để di chuyển, x để chọn

THỐNG KÊ
- Thời lượng video và những năm mà một kênh làm tốt nhất
- So sánh hai kênh cạnh nhau
- Danh sách theo dõi phát hiện video vượt lượt xem thường ngày của kênh

Không cần đăng nhập, không cần tài khoản, không gửi gì đi đâu cả. Mọi thứ chạy trong trình duyệt của bạn.

Giao diện của tiện ích bằng tiếng Anh.

Không liên kết với YouTube hay Google.`,
  },

  th: {
    n: "Needle สำหรับ YouTube: ค้นหาในช่อง ค้นหาประวัติการดู และตัวกรอง",
    s: "การค้นหา YouTube ที่รู้ว่าคุณดูอะไรไปแล้ว ค้นหาและกรองช่อง ประวัติการดู และดูภายหลัง",
    d: `การค้นหาของ YouTube ไม่รู้ว่าคุณดูอะไรไปแล้ว กรองตามความยาวหรือยอดวิวไม่ได้ และการค้นหาในช่องก็ดูแค่ชื่อวิดีโอ Needle แก้ปัญหานี้ได้ในแถบค้นหาของ YouTube โดยตรง

ในแถบค้นหา
- วิดีโอในดูภายหลัง วิดีโอที่ชอบ และประวัติการดู จะแสดงขึ้นขณะพิมพ์
- พิมพ์ตัวกรอง: <20m, >100k, unwatched, date:week, @ช่อง
- in:playlists ค้นหาในทุกเพลย์ลิสต์ที่คุณบันทึกไว้
- is:fresh ซ่อนสิ่งที่เคยแสดงให้คุณเห็นแล้ว
- ติดตามการค้นหา ซ่อนช่อง และดูว่าวิดีโอไหนดูไปแล้วบนทุกภาพขนาดย่อ

ค้นหาในช่อง
กดปุ่มรูปเข็มในแท็บวิดีโอของช่องใดก็ได้ Needle อ่านวิดีโอทั้งหมดของช่อง ไม่ใช่แค่ที่โหลดมาแล้ว
- กรองตามความยาว ยอดวิว วันที่ และคำสำคัญ
- ซ่อนวิดีโอที่ดูจบแล้ว หรือหาวิดีโอที่ดูค้างไว้
- เลือกจำนวนนาทีที่มี แล้วดูเฉพาะวิดีโอที่พอดีเวลา

ประวัติการดูและดูภายหลัง
- ทุกวิดีโอที่เริ่มดูแต่ยังไม่จบ
- กรองตามช่อง ความยาว ยอดวิว หรือช่วงเวลาที่ดู
- หาวิดีโอที่มั่นใจว่าเคยดูได้ โดยไม่ต้องเลื่อนหาไม่รู้จบ

เพลย์ลิสต์ใดก็ได้ และช่องที่ติดตาม
- ค้นหาและกรองเพลย์ลิสต์ใดก็ได้ ทั้งของคุณและของคนอื่น ได้ครบทั้งรายการ
- ช่องที่คุณติดตาม เฉพาะวิดีโอที่ยังไม่ดูและสั้นกว่า 20 นาที
- ทำให้จางหรือซ่อนวิดีโอที่ดูแล้วในหน้าแรกและการติดตาม

จัดระเบียบ เล่น แชร์
- จัดระเบียบดูภายหลังและเพลย์ลิสต์ของคุณเอง เลิกชอบทีละหลายรายการ และล้างวิดีโอที่ถูกลบ พร้อมการเลิกทำและที่เก็บถาวรสำหรับนำกลับมา
- เล่นวิดีโอที่กรองไว้ตามลำดับ หรือคัดลอกลิงก์ไปใช้กับ NotebookLM
- แชร์ตัวกรองเป็นลิงก์: ใครที่มี Needle เปิดแล้วจะเห็นรายการเดียวกันด้วยตัวกรองเดียวกัน
- แป้นพิมพ์: / เพื่อค้นหา j และ k เพื่อเลื่อน x เพื่อเลือก

ข้อมูลเชิงลึก
- ความยาววิดีโอและปีที่ช่องทำผลงานได้ดีที่สุด
- เปรียบเทียบสองช่องแบบเคียงข้างกัน
- รายการเฝ้าดูที่จับวิดีโอซึ่งมียอดวิวสูงกว่าปกติของช่อง

ไม่ต้องลงชื่อเข้าใช้ ไม่ต้องมีบัญชี ไม่ส่งข้อมูลไปที่ไหนเลย ทุกอย่างทำงานในเบราว์เซอร์ของคุณ

หน้าตาของส่วนขยายเป็นภาษาอังกฤษ

ไม่มีส่วนเกี่ยวข้องกับ YouTube หรือ Google`,
  },

  fil: {
    n: "Needle para sa YouTube: Paghahanap sa Channel, History at mga Filter",
    s: "Ang YouTube search na alam kung ano na ang napanood mo. Maghanap at mag-filter ng channel, history at Panoorin Mamaya.",
    d: `Hindi alam ng search ng YouTube kung ano na ang napanood mo, hindi ito makapag-filter ayon sa haba o views, at ang paghahanap sa loob ng channel ay tumitingin lang sa mga pamagat. Inaayos iyan ng Needle, mismo sa search bar ng YouTube.

SA SEARCH BAR
- Lumalabas ang Panoorin Mamaya, mga ni-like mo at ang iyong history habang nagta-type ka
- Mag-type ng filter: <20m, >100k, unwatched, date:week, @channel
- Hinahanap ng in:playlists ang bawat playlist na na-save mo
- Itinatago ng is:fresh ang mga naipakita na sa iyo
- Sundan ang isang search, i-mute ang isang channel at makita sa bawat thumbnail kung ano na ang napanood mo

MAGHANAP SA ISANG CHANNEL
Pindutin ang needle button sa Videos tab ng kahit anong channel. Binabasa ng Needle ang bawat video ng channel, hindi lang ang mga na-load na.
- Mag-filter ayon sa haba, views, petsa at keyword
- Itago ang mga natapos mo na, o hanapin ang mga hindi mo tinapos
- Piliin kung ilang minuto ang mayroon ka at makita lang ang kasya

ANG IYONG HISTORY AT PANOORIN MAMAYA
- Lahat ng sinimulan mo pero hindi tinapos
- Mag-filter ayon sa channel, haba, views o kung kailan mo ito pinanood
- Hanapin ang video na sigurado kang napanood mo na, nang hindi nag-i-scroll nang walang katapusan

KAHIT ANONG PLAYLIST AT ANG IYONG MGA SUBSCRIPTION
- Maghanap at mag-filter sa kahit anong playlist, sa iyo man o sa iba, buo
- Ang iyong mga subscription, ang hindi mo pa napapanood at wala pang 20 minuto lang
- Palabuin o itago ang mga napanood mo na sa Home at sa Mga Subscription

MAGLINIS, MAG-PLAY, MAG-SHARE
- Linisin ang Panoorin Mamaya at ang sarili mong mga playlist, mag-unlike nang maramihan at alisin ang mga na-delete na video, may undo at archive para maibalik ang anuman
- I-play ang na-filter mo nang sunud-sunod, o kopyahin ang mga link para sa NotebookLM
- I-share ang isang filter bilang link: binubuksan nito ang parehong listahan na may parehong filter para sa sinumang may Needle
- Keyboard: / para maghanap, j at k para gumalaw, x para pumili

INSIGHTS
- Ang haba ng video at mga taon kung kailan pinakamagaling ang isang channel
- Ikumpara ang dalawang channel nang magkatabi
- Isang watchlist na nakakakita ng mga video na lumalampas sa karaniwang views ng kanilang channel

Walang sign-in, walang account, walang ipinapadala kahit saan. Tumatakbo ito sa iyong browser.

Nasa Ingles ang interface ng extension.

Hindi kaakibat ng YouTube o Google.`,
  },

  hi: {
    n: "Needle for YouTube: चैनल में खोज, इतिहास में खोज और फ़िल्टर",
    s: "YouTube की वह खोज जो जानती है कि आप क्या देख चुके हैं। चैनल, देखने का इतिहास और बाद में देखें, सब खोजें और फ़िल्टर करें।",
    d: `YouTube की खोज नहीं जानती कि आप क्या देख चुके हैं, लंबाई या व्यू के हिसाब से फ़िल्टर नहीं कर सकती, और चैनल के अंदर की खोज सिर्फ़ टाइटल देखती है। Needle यह सब ठीक करता है, सीधे YouTube के सर्च बार में।

सर्च बार में
- टाइप करते ही आपके बाद में देखें, पसंद किए गए वीडियो और इतिहास दिखने लगते हैं
- फ़िल्टर टाइप करें: <20m, >100k, unwatched, date:week, @चैनल
- in:playlists आपकी सेव की हुई हर प्लेलिस्ट में खोजता है
- is:fresh वह छिपा देता है जो आपको पहले दिखाया जा चुका है
- किसी खोज को फ़ॉलो करें, किसी चैनल को म्यूट करें, और हर थंबनेल पर देखें कि आप क्या देख चुके हैं

किसी चैनल में खोजें
किसी भी चैनल के वीडियो टैब पर सुई वाला बटन दबाएँ। Needle चैनल का हर वीडियो पढ़ता है, सिर्फ़ लोड हुए वीडियो नहीं।
- लंबाई, व्यू, तारीख़ और कीवर्ड से फ़िल्टर करें
- जो पूरा देख लिया उसे छिपाएँ, या जो बीच में छोड़ा उसे ढूँढें
- बताइए आपके पास कितने मिनट हैं, और सिर्फ़ उतने में आने वाले वीडियो देखें

आपका इतिहास और बाद में देखें
- वह सब जो आपने शुरू किया पर कभी पूरा नहीं किया
- चैनल, लंबाई, व्यू या देखने के समय से फ़िल्टर करें
- वह वीडियो ढूँढें जो आपने पक्का देखा था, बिना लगातार स्क्रॉल किए

कोई भी प्लेलिस्ट और आपकी सदस्यताएँ
- कोई भी प्लेलिस्ट खोजें और फ़िल्टर करें, आपकी हो या किसी और की, पूरी की पूरी
- आपकी सदस्यताएँ, सिर्फ़ बिना देखे और 20 मिनट से छोटे वीडियो
- होम और सदस्यताओं में पहले से देखे गए वीडियो धुंधले करें या छिपाएँ

सफ़ाई, प्ले, शेयर
- बाद में देखें और अपनी प्लेलिस्ट साफ़ करें, एक साथ कई लाइक हटाएँ और डिलीट हो चुके वीडियो निकालें, अनडू और एक आर्काइव के साथ जिससे सब वापस लाया जा सके
- जो फ़िल्टर किया उसे क्रम से चलाएँ, या NotebookLM के लिए लिंक कॉपी करें
- किसी फ़िल्टर को लिंक की तरह शेयर करें: जिसके पास भी Needle है, उसके लिए वही सूची उन्हीं फ़िल्टर के साथ खुलती है
- कीबोर्ड: खोजने के लिए /, आगे-पीछे जाने के लिए j और k, चुनने के लिए x

इनसाइट्स
- किसी चैनल के सबसे अच्छा प्रदर्शन करने वाले वीडियो की लंबाई और साल
- दो चैनलों की आमने-सामने तुलना
- एक वॉचलिस्ट जो चैनल के सामान्य व्यू से आगे निकलने वाले वीडियो पकड़ती है

न साइन-इन, न अकाउंट, कुछ भी कहीं नहीं भेजा जाता। सब कुछ आपके ब्राउज़र में चलता है।

एक्सटेंशन का इंटरफ़ेस अंग्रेज़ी में है।

YouTube या Google से संबद्ध नहीं।`,
  },
};
