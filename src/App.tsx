import type { InventoryService, SaleState } from "./domain/contracts";
import { SALE_CONFIG } from "./domain/saleConfig";
import { saleInventory } from "./domain/saleSession";
import { useSaleController } from "./hooks/useSaleController";
import { formatCountdown } from "./utils/formatCountdown";
import "./App.css";

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

function messageForState(state: SaleState): string {
  switch (state.tag) {
    case "idle":
      return "Sẵn sàng tham gia phiên giữ hàng.";
    case "reserving":
      return "Đang gửi yêu cầu giữ 1 sản phẩm…";
    case "reserved":
      return "Đã giữ sản phẩm cho bạn. Hãy thanh toán trước khi hết giờ.";
    case "checkingOut":
      return "Đang xác nhận thanh toán mô phỏng…";
    case "completed":
      return "Thanh toán mô phỏng thành công. Sản phẩm đã được bán.";
    case "expired":
      return state.message;
    case "error":
      return state.message;
  }
}

function isErrorState(state: SaleState): boolean {
  return state.tag === "error";
}

export interface SalePageProps {
  readonly service?: InventoryService;
}

export function SalePage({ service = saleInventory }: SalePageProps) {
  const controller = useSaleController(service);
  const { inventory, state, saleRemainingMs, reservationRemainingMs } = controller;
  const reservation =
    state.tag === "reserved" || state.tag === "checkingOut"
      ? state.reservation
      : state.tag === "error"
        ? state.reservation
        : undefined;
  const saleEnded = saleRemainingMs === 0;
  const buyDisabled =
    state.tag === "reserving" ||
    state.tag === "reserved" ||
    state.tag === "checkingOut" ||
    state.tag === "completed" ||
    (state.tag === "error" && state.reservation !== undefined) ||
    inventory.available === 0 ||
    saleEnded;
  const canCheckout =
    state.tag === "reserved" ||
    (state.tag === "error" && state.retryable && state.reservation !== undefined);
  const checkoutInProgress = state.tag === "checkingOut";
  const announcement = messageForState(state);

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="#sale" aria-label="MegaSale, về đầu trang">
          <span className="wordmark-mark" aria-hidden="true">M</span>
          <span>MegaSale</span>
        </a>
        <p className="topbar-note">Chương trình mô phỏng trong trình duyệt</p>
      </header>

      <section className="sale-layout" id="sale" aria-labelledby="sale-heading">
        <div className="sale-copy">
          <p className="eyebrow"><span className="live-dot" /> Vietnam Mega-Sale</p>
          <h1 id="sale-heading" aria-label="Săn deal chớp nhoáng. Giữ hàng kịp lúc.">
            Săn deal chớp nhoáng.<br /><span>Giữ hàng kịp lúc.</span>
          </h1>
          <p className="intro-copy">
            Một sản phẩm, số lượng hữu hạn. Hàng chỉ được giữ khi kho xác nhận;
            bạn có {SALE_CONFIG.reservationDurationMs / 1_000} giây để hoàn tất thanh toán mô phỏng.
          </p>

          <article className="product-card" aria-labelledby="product-heading">
            <div className="product-art" aria-hidden="true">
              <span className="art-orbit art-orbit-one" />
              <span className="art-orbit art-orbit-two" />
              <svg viewBox="0 0 220 180" role="presentation" focusable="false">
                <defs>
                  <linearGradient id="cup" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#fff6df" />
                    <stop offset="1" stopColor="#d9d1c4" />
                  </linearGradient>
                </defs>
                <path d="M42 95V78a68 68 0 0 1 136 0v17" fill="none" stroke="#292c31" strokeWidth="15" strokeLinecap="round" />
                <rect x="29" y="85" width="42" height="65" rx="18" fill="url(#cup)" stroke="#35383d" strokeWidth="5" />
                <rect x="149" y="85" width="42" height="65" rx="18" fill="url(#cup)" stroke="#35383d" strokeWidth="5" />
                <rect x="41" y="99" width="18" height="37" rx="9" fill="#ad6d3e" opacity=".42" />
                <rect x="161" y="99" width="18" height="37" rx="9" fill="#ad6d3e" opacity=".42" />
                <path d="M58 82a52 52 0 0 1 104 0" fill="none" stroke="#d4a273" strokeWidth="5" strokeLinecap="round" />
              </svg>
              <span className="art-caption">MEGASOUND · SERIES 01</span>
            </div>

            <div className="product-info">
              <div className="product-title-row">
                <div>
                  <p className="product-kicker">Tai nghe · Chống ồn</p>
                  <h2 id="product-heading">{SALE_CONFIG.productName}</h2>
                </div>
                <span className="sale-badge">−35%</span>
              </div>
              <div className="price-line">
                <strong>{priceFormatter.format(SALE_CONFIG.priceVnd)}</strong>
                <span className="old-price">1.990.000 ₫</span>
              </div>

              <div className="inventory-grid" aria-label="Tình trạng tồn kho">
                <div className="inventory-cell">
                  <span>Còn lại</span>
                  <strong aria-live="polite">{inventory.available}</strong>
                </div>
                <div className="inventory-cell">
                  <span>Đang giữ</span>
                  <strong>{inventory.reserved}</strong>
                </div>
                <div className="inventory-cell">
                  <span>Đã bán</span>
                  <strong>{inventory.sold}</strong>
                </div>
              </div>

              <div className="sale-timer-row">
                <span>{saleEnded ? "Phiên sale đã kết thúc" : "Kết thúc sau"}</span>
                <time
                  className="countdown sale-countdown"
                  aria-label={`Thời gian sale còn ${formatCountdown(saleRemainingMs)}`}
                >
                  {formatCountdown(saleRemainingMs)}
                </time>
              </div>

              <button
                className="primary-button buy-button"
                type="button"
                onClick={() => void controller.buy()}
                disabled={buyDisabled}
                aria-describedby="stock-note"
              >
                {state.tag === "reserving" ? "Đang giữ hàng…" : "Mua ngay"}
                <span aria-hidden="true">↗</span>
              </button>
              <p className="stock-note" id="stock-note">
                Mỗi lần mua giữ 1 đơn vị. Kho cập nhật sau khi dịch vụ xác nhận.
              </p>

              {reservation && (
                <div className="reservation-panel">
                  <div>
                    <span className="reservation-label">Hàng của bạn được giữ thêm</span>
                    <time
                      className="countdown hold-countdown"
                      aria-label={`Thời gian giữ hàng còn ${formatCountdown(reservationRemainingMs)}`}
                    >
                      {formatCountdown(reservationRemainingMs)}
                    </time>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void controller.checkout()}
                    disabled={!canCheckout || checkoutInProgress || reservationRemainingMs === 0}
                  >
                    {checkoutInProgress
                      ? "Đang xác nhận…"
                      : state.tag === "error"
                        ? "Thử lại thanh toán"
                        : "Thanh toán"}
                  </button>
                </div>
              )}

              {state.tag === "completed" && (
                <div className="completion-panel" role="status">
                  <span className="completion-check" aria-hidden="true">✓</span>
                  <div>
                    <strong>Đặt hàng thành công</strong>
                    <p>Đây là bước thanh toán mô phỏng, không phát sinh giao dịch thật.</p>
                  </div>
                </div>
              )}

              <p
                className={`state-message${isErrorState(state) ? " is-error" : ""}`}
                role={isErrorState(state) ? "alert" : "status"}
                aria-live={isErrorState(state) ? "assertive" : "polite"}
                aria-atomic="true"
              >
                {announcement}
              </p>
            </div>
          </article>
        </div>

        <aside className="sale-aside" aria-label="Thể lệ mô phỏng">
          <div className="aside-number">11.11</div>
          <p className="aside-label">FLASH SALE</p>
          <div className="aside-rule" />
          <p className="aside-copy">Đồng hồ bám theo thời hạn thực. Kho chỉ xác nhận khi yêu cầu tới service.</p>
          <ul className="aside-steps">
            <li><span>01</span> Giữ 1 sản phẩm</li>
            <li><span>02</span> Thanh toán trong 15 giây</li>
            <li><span>03</span> Hết hạn, hàng về kho</li>
          </ul>
          <p className="aside-footnote">Phiên demo tự bắt đầu khi trang được khởi tạo.</p>
        </aside>
      </section>

      <footer className="page-footer">
        <span>Demo học tập · Tồn kho trong bộ nhớ trình duyệt</span>
        <span>Không kết nối cổng thanh toán</span>
      </footer>
    </main>
  );
}

export default function App() {
  return <SalePage />;
}
