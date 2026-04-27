<?php
/**
 * Proef Griekenland — Floating Sommelier Widget
 * Toont een vaste knop rechtsonder op elke pagina.
 * Klik opent de sommelier-app als overlay.
 *
 * ⚙️  Pas SOMMELIER_PROXY_URL aan naar jouw live proxy-URL.
 *
 * Code Snippets → PHP → Run everywhere → activeren
 */

define( 'SOMMELIER_PROXY_URL', 'https://creative-fascination-production-30b1.up.railway.app' );

add_action( 'wp_footer', 'proefgriekenland_sommelier_widget' );

/**
 * Shortcode [sommelier_cta] — ghost CTA-knop die de widget opent
 * Gebruik in de pagina-editor naast een bestaande knop
 * Optioneel: [sommelier_cta tekst="Vraag de sommelier"]
 */
add_shortcode( 'sommelier_cta', 'proefgriekenland_sommelier_cta' );

function proefgriekenland_sommelier_cta( $atts ) {
    $atts  = shortcode_atts( [ 'tekst' => 'Vraag de sommelier' ], $atts );
    $tekst = esc_html( $atts['tekst'] );
    return '
        <style>
        .pg-som-cta-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 22px;
            background: transparent;
            color: #fff;
            border: 2px solid rgba(255,255,255,.85);
            border-radius: 50px;
            font-family: inherit;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background .2s, border-color .2s, color .2s;
            text-decoration: none;
            white-space: nowrap;
            vertical-align: middle;
        }
        .pg-som-cta-btn:hover {
            background: rgba(255,255,255,.15);
            border-color: #fff;
        }
        </style>
        <button class="pg-som-cta-btn" onclick="var b=document.getElementById(\'pg-som-btn\');if(b)b.click();">
            🍷 ' . $tekst . '
        </button>';
}

function proefgriekenland_sommelier_widget() {
    $proxy = esc_url( SOMMELIER_PROXY_URL );
    ?>
    <style>
    /* ── Floating knop ───────────────────────────────── */
    #pg-som-btn {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 99998;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 13px 20px 13px 16px;
        background: #4273bd;
        color: #fff;
        border: none;
        border-radius: 50px;
        font-family: 'Sarabun', sans-serif;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 18px rgba(66,115,189,.45);
        transition: transform .2s, box-shadow .2s, background .2s;
        text-decoration: none;
        white-space: nowrap;
    }
    #pg-som-btn:hover {
        background: #3461a8;
        transform: translateY(-2px);
        box-shadow: 0 6px 24px rgba(66,115,189,.55);
    }
    #pg-som-btn svg {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
    }
    /* Puls-ring om aandacht te trekken */
    #pg-som-btn::before {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50px;
        border: 2px solid rgba(66,115,189,.5);
        animation: pg-som-pulse 2.4s ease-out infinite;
        pointer-events: none;
    }
    @keyframes pg-som-pulse {
        0%   { transform: scale(1);   opacity: .8; }
        70%  { transform: scale(1.12); opacity: 0; }
        100% { transform: scale(1.12); opacity: 0; }
    }
    /* Pulse stopt als overlay open is */
    body.pg-som-open #pg-som-btn::before { animation: none; }

    /* ── Overlay backdrop ────────────────────────────── */
    #pg-som-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: rgba(0,0,0,.45);
        backdrop-filter: blur(2px);
        align-items: flex-end;
        justify-content: flex-end;
        padding: 0;
    }
    #pg-som-overlay.open {
        display: flex;
        animation: pg-som-fadein .2s ease;
    }
    @keyframes pg-som-fadein {
        from { opacity: 0; }
        to   { opacity: 1; }
    }

    /* ── Widget-paneel ───────────────────────────────── */
    #pg-som-panel {
        position: relative;
        width: 600px;
        max-width: 100vw;
        height: 78vh;
        max-height: 720px;
        background: #fff;
        border-radius: 18px 18px 0 0;
        overflow: hidden;
        box-shadow: 0 -8px 40px rgba(0,0,0,.18);
        display: flex;
        flex-direction: column;
        animation: pg-som-slideup .28s cubic-bezier(.22,.68,0,1.2);
        margin-right: 28px;
        margin-bottom: 0;
    }
    @keyframes pg-som-slideup {
        from { transform: translateY(60px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
    }

    /* Sluiten-knop */
    #pg-som-close {
        position: absolute;
        top: 12px;
        right: 14px;
        z-index: 10;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        background: rgba(0,0,0,.08);
        color: #444;
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .15s;
    }
    #pg-som-close:hover { background: rgba(0,0,0,.16); }

    /* iframe vult het paneel */
    #pg-som-iframe {
        flex: 1;
        border: none;
        width: 100%;
        height: 100%;
    }

    /* reCAPTCHA badge verbergen */
    .grecaptcha-badge { display: none !important; }

    /* Mobiel: full-screen, geen marge */
    @media (max-width: 600px) {
        #pg-som-btn {
            display: flex !important;
            bottom: 18px !important;
            right: 18px !important;
            padding: 11px 16px 11px 13px;
            font-size: 14px;
            z-index: 99998 !important;
        }
        #pg-som-overlay {
            padding: 0;
            align-items: flex-end;
            justify-content: center;
        }
        #pg-som-panel {
            width: 100vw;
            height: 95dvh;
            max-height: none;
            border-radius: 18px 18px 0 0;
            margin-right: 0;
            margin-bottom: 0;
        }
    }
    </style>

    <!-- Floating knop -->
    <button id="pg-som-btn" aria-label="Open sommelier">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 22h8M12 11v11M6.5 3h11l-2 8H8.5L6.5 3z"/>
            <path d="M6.5 3C6.5 3 5 6 12 8s5.5 5 5.5 5"/>
        </svg>
        Vraag de sommelier
    </button>

    <!-- Overlay -->
    <div id="pg-som-overlay" role="dialog" aria-modal="true" aria-label="Sommelier">
        <div id="pg-som-panel">
            <button id="pg-som-close" aria-label="Sluiten">✕</button>
            <iframe id="pg-som-iframe" src="" title="Proef Griekenland Sommelier" loading="lazy"></iframe>
        </div>
    </div>

    <script>
    (function () {
        var btn     = document.getElementById('pg-som-btn');
        var overlay = document.getElementById('pg-som-overlay');
        var panel   = document.getElementById('pg-som-panel');
        var closeBtn= document.getElementById('pg-som-close');
        var iframe  = document.getElementById('pg-som-iframe');
        var loaded  = false;

        function open() {
            // Laad iframe pas bij eerste klik (sneller initieel laden pagina)
            if (!loaded) {
                iframe.src = '<?php echo esc_js( $proxy ); ?>/widget.html';
                loaded = true;
            }
            overlay.classList.add('open');
            document.body.classList.add('pg-som-open');
            document.body.style.overflow = 'hidden';
            closeBtn.focus();
        }

        function close() {
            overlay.classList.remove('open');
            document.body.classList.remove('pg-som-open');
            document.body.style.overflow = '';
            btn.focus();
        }

        btn.addEventListener('click', open);
        closeBtn.addEventListener('click', close);

        // Klik buiten het paneel sluit de overlay
        overlay.addEventListener('click', function (e) {
            if (!panel.contains(e.target)) close();
        });

        // Escape-toets sluit
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('open')) close();
        });

        // ── Hero CTA-knop injecteren naast bestaande knop ──────────────
        function injectHeroBtn() {
            if (document.getElementById('pg-som-hero-btn')) return;
            var existingBtn = document.querySelector('.header__image a.button--lightblue');
            if (!existingBtn) return;

            var heroBtn = document.createElement('button');
            heroBtn.id = 'pg-som-hero-btn';
            heroBtn.textContent = '🍷 Vraag de sommelier';
            heroBtn.addEventListener('click', open);
            existingBtn.insertAdjacentElement('afterend', heroBtn);

            // Kopieer exact dezelfde afmetingen van de bestaande knop
            var cs = window.getComputedStyle(existingBtn);
            heroBtn.style.paddingTop    = cs.paddingTop;
            heroBtn.style.paddingBottom = cs.paddingBottom;
            heroBtn.style.paddingLeft   = cs.paddingLeft;
            heroBtn.style.paddingRight  = cs.paddingRight;
            heroBtn.style.fontSize      = cs.fontSize;
            heroBtn.style.fontWeight    = cs.fontWeight;
            heroBtn.style.lineHeight    = cs.lineHeight;
            heroBtn.style.letterSpacing = cs.letterSpacing;
            heroBtn.style.borderRadius  = cs.borderRadius;
            heroBtn.style.height        = cs.height;
            heroBtn.style.marginLeft    = '12px';
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectHeroBtn);
        } else {
            injectHeroBtn();
        }
    })();
    </script>
    <style>
    #pg-som-hero-btn {
        /* Padding, font-size, font-weight en border-radius worden via JS
           gekopieerd van .button--lightblue zodat ze altijd exact matchen */
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        color: #fff;
        border: 2px solid rgba(255,255,255,.85);
        font-family: inherit;
        cursor: pointer;
        transition: background .2s, border-color .2s;
        white-space: nowrap;
        vertical-align: middle;
        box-sizing: border-box;
    }
    #pg-som-hero-btn:hover {
        background: rgba(255,255,255,.18);
        border-color: #fff;
    }
    @media (max-width: 600px) {
        #pg-som-hero-btn { margin-left: 0 !important; margin-top: 10px; display: flex; }
    }
    </style>
    <?php
}
