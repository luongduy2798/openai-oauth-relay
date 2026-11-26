# OpenAI OAuth Relay

Extension Chrome chuyển callback OAuth của Codex về dashboard đã khởi tạo phiên. Tương thích với Quota Pilot, LCA và các app dùng cùng giao thức.

## Cài và dùng

1. Dùng Chrome 102 trở lên. Mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** rồi chọn thư mục repo này.
2. Nếu đang dùng **Quota Pilot OAuth Callback**, tắt bản đó trong `chrome://extensions` để tránh hai extension cùng xử lý callback.
3. Bấm **OpenAI OAuth Relay** trong menu Extensions. Nhập `https://quota.chillix.me` hoặc địa chỉ dashboard cần dùng, bấm **Thêm** rồi cấp quyền Chrome. Danh sách hỗ trợ nhiều origin HTTPS và origin HTTP trên `localhost` hoặc `127.0.0.1`. Các cổng khác nhau là các origin riêng.
4. Bật relay và tải lại tab dashboard. Trong Quota Pilot, vào **Accounts → Connect**. Trong LCA, vào **Tài khoản → Đăng nhập ChatGPT**.

Sau khi cập nhật bản cài bằng **Load unpacked**, bấm **Reload** ở extension trong `chrome://extensions`, rồi tải lại dashboard.

Trang quản lý hiển thị dashboard khởi tạo, URL callback localhost, thời điểm nhận, tên các tham số và URL đích. Trạng thái **Đã chuyển tiếp callback** ghi nhận Chrome đã mở URL đích. Dashboard xử lý kết quả đăng nhập.

Relay mặc định tắt. Khi tắt, extension hủy các phiên đang chờ và ngừng chuyển tiếp. Bật lại rồi tải lại tab trước khi đăng nhập. Cấu hình domain được lưu qua các lần mở Chrome. Hoạt động gần nhất và các phiên chờ nằm trong bộ nhớ phiên trình duyệt. Nhật ký chỉ lưu tên tham số đã biết và số lượng tham số khác.

Chrome chuyển hướng callback trước khi kết nối tới localhost. Rule chỉ áp dụng cho điều hướng trang chính có `state` của phiên đang chờ. Rule được dọn khi nhận callback, hủy phiên, đóng tab khởi tạo hoặc hết hạn.

## Giao thức dashboard

- Mỗi origin phục vụ endpoint `GET /api/oauth/codex/callback`. Đăng ký redirect URI phía OAuth là `http://localhost:1455/auth/callback`. Extension cũng nhận callback từ `http://127.0.0.1:1455/auth/callback`.
- Dashboard gửi `window.postMessage` tới `window.location.origin` với `source: "quota-pilot-page"`, `type: "extension-ping" | "oauth-start" | "oauth-stop"` và chuỗi `nonce` riêng cho mỗi yêu cầu. `oauth-start` và `oauth-stop` cần `state` ngẫu nhiên gồm 43 ký tự base64url, cùng giá trị dùng lúc bắt đầu OAuth.
- Phản hồi dùng `source: "quota-pilot-oauth-extension"` và trả lại `nonce`. `extension-ping` nhận `extension-pong` với `installed`. Hai lệnh OAuth nhận `<type>-result` với `ok` và có thể có `error`.
- Chờ `oauth-start-result` thành công trước khi mở trang authorize. Phiên chờ hết hạn sau 10 phút. Khi `state` khớp, extension giữ nguyên query của callback và chuyển tab OAuth về endpoint trên chính origin khởi tạo. Dashboard xác thực `state` và đổi `code` ở backend.

Kiểm tra logic định tuyến bằng `node relay.check.mjs`.
