# MSIS207.R11.CTTT — HW3 Mega-Sale

Mô phỏng flash sale một sản phẩm tại Việt Nam bằng React, TypeScript strict, Vite và CSS thuần.

## Chạy ứng dụng

Yêu cầu Node.js 20.19+.

```bash
npm ci
npm run dev
```

Các lệnh kiểm chứng:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run verify:browser
```

`verify:browser` cần Google Chrome đã cài và cổng 5413 còn trống. Script tự mở/đóng Vite và Chrome headless, dùng clock điều khiển được để giữ phản hồi reserve 16 giây khi TTL chỉ 15 giây, rồi kiểm tra hết hạn → mua lại → thanh toán. Bằng chứng JSON và ảnh nằm trong `evidence/`.

## Mô hình trạng thái

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> reserving: Mua ngay
    reserving --> reserved: service xác nhận
    reserving --> expired: phản hồi hiện tại đến sau hạn giữ hàng
    reserving --> error: hết hàng hoặc sale kết thúc
    reserved --> checkingOut: thanh toán trước hạn
    checkingOut --> completed: checkout được chấp nhận
    checkingOut --> expired: expiry thắng race
    checkingOut --> error: lỗi có thể thử lại
    error --> checkingOut: thử lại khi giữ hàng còn hạn
    error --> reserving: thử mua lại khi chưa giữ hàng
    reserved --> expired: hết 15 giây
    expired --> reserving: mua lại khi sale còn mở
```

## Quy tắc thời gian và tồn kho

Thông số demo nằm ở [`src/domain/saleConfig.ts`](src/domain/saleConfig.ts): một tai nghe giá 1.290.000 ₫, tồn kho 5, phiên sale 120 giây, giữ một đơn vị mỗi lần trong 15 giây.

Countdown giữ deadline tuyệt đối và mỗi frame tính `Math.max(0, targetTime - Date.now())`; không tích lũy bằng `setInterval`. Khi tab hiển thị lại, timer tính lại từ deadline. Service kiểm tra deadline sale và reservation ngay tại thao tác, nên giá trị hiển thị không quyết định quyền mua hay checkout. Hàng đã được giữ vẫn checkout được sau khi sale đóng, cho đến hạn riêng của reservation.

`InMemoryInventoryService` là nguồn sự thật duy nhất trong phiên mô phỏng. Mỗi lần cập nhật phải giữ bất biến `available + reserved + sold = initialStock`; cả ba số không âm. Reservation và checkout có ID ổn định, kiểm soát phản hồi cũ bằng ID/version, hết hạn trả hàng đúng một lần và checkout lặp không bán lần hai.

Phản hồi reserve thành công đã hết hạn được chuyển thành sự kiện `RESERVE_EXPIRED` có request ID. Chỉ yêu cầu `reserving` tương ứng được chuyển sang `expired`; người dùng có thể mua lại nếu sale còn mở. Phản hồi cũ bị bỏ qua, và reservation trả về sau unmount được giải phóng an toàn.

## Giới hạn

Tồn kho chỉ ở trong bộ nhớ của một trang/trình duyệt đang chạy. Tải lại trang khởi tạo phiên mới; các tab riêng không đồng bộ với nhau. Không có backend, database, đăng nhập, giỏ hàng nhiều sản phẩm hay thanh toán thật. Không triển khai website.

## Kết quả kiểm chứng

- Typecheck, lint và production build đều thành công.
- 25 unit/component tests qua, gồm timer, transition, 100 yêu cầu đồng thời với stock 5, expiry một lần, checkout/race, phản hồi trễ/cũ/sau unmount và React StrictMode.
- Đã kiểm tra bằng browser preview: mua → giữ hàng → checkout; sau khi tải lại, mua → hết hạn → tồn kho trở về 5.
- Regression trong Chrome xác nhận phản hồi trễ 16 giây thoát `reserving`, trả kho về 5/0/0, cho mua lại và checkout thành 4/0/1; không có lỗi console/page. Xem [bằng chứng JSON](evidence/delayed-reservation-browser.json) và [ảnh UI phục hồi](evidence/delayed-reservation-recovered.png).
- Chi tiết chạy lại và các lỗi AI đã phát hiện nằm trong [`evidence/verification.md`](evidence/verification.md) và [`AI_FAILURE_AUDIT.md`](AI_FAILURE_AUDIT.md).
