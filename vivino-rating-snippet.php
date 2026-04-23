<?php
/**
 * Vivino-beoordeling op WooCommerce productpagina
 * Werkt via wp_footer + JS — thema-onafhankelijk
 * Code Snippets → PHP → Run everywhere → activeren
 */

add_action( 'wp_footer', 'proefgriekenland_vivino_inject' );

function proefgriekenland_vivino_inject() {
    if ( ! is_product() ) return;

    $product_id  = get_the_ID();
    $score       = get_post_meta( $product_id, '_sommelier_vivino_score', true );
    $count       = get_post_meta( $product_id, '_sommelier_vivino_count', true );

    if ( empty( $score ) ) return;

    $score_float = floatval( $score );
    $pct         = number_format( min( 100, $score_float / 5 * 100 ), 1, '.', '' );
    $score_nl    = number_format( $score_float, 1, ',', '' );
    $count_str   = ! empty( $count ) ? esc_js( $count ) . ' beoordelingen' : '';

    $logo_b64 = 'PHN2ZyB2aWV3Qm94PSIwIDAgMTI1IDIyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj4KIDxwYXRoIGQ9Ik0xNjc3Ljg3LDQ1MC45MzdoNS41N1Y0MjkuMTZoLTUuNTd2MjEuNzc3Wm0zNi44NCwwLjAwNiw1LjU2LS4wMTJWNDI5LjE3MmgtNS41NnYyMS43NzFabS02My43My0yMS43OTIsNS41OSwwLDUuNDUsMTIuNTU1aDAuMzhsNS41NC0xMi41NTksNS43MS0uMDA4LTkuNTIsMjEuOC0zLjU0LjAxMlptMzYuNzcsMC4wMTgsNS41NywwLjAwNyw1LjQzLDEyLjUzNGgwLjQxbDUuNDktMTIuNTQxLDUuNzEsMC4wMDctOS40NywyMS43NjEtMy41Ni4wMTFabTM5LjcyLS4wMThoMy45MmMwLjUsMC43LjkzLDEuMzMxLDEuMzcsMS45aDAuMzhjNS41Ni00LjIyMywxNC4wOC0xLjU3NywxNC4wOCw1LjU4NWwtMC4wMSwxNC4zMDVoLTUuNDJsLTAuMDUtMTMuNDIzYy0wLjI3LTQuNDYzLTYuOS01LjEtOC4xOS0uNTYxYTE0LjEyNiwxNC4xMjYsMCwwLDAtLjQxLDQuNDA5bDAuMDEsOS41ODYtNS43MS0uMDExWm0zNy0uMTYyYzYuMzUsMCwxMS41Myw0Ljk0NCwxMS41MywxMC45ODNhMTEuMywxMS4zLDAsMCwxLTExLjUzLDExLjAzN3YtNC41N2E2LjMyMSw2LjMyMSwwLDAsMCwwLTEyLjY0MXYtNC44MDlabTAsMjIuMDJhMTEuMywxMS4zLDAsMCwxLTExLjUzLTExLjAzN2MwLTYuMDM5LDUuMTgtMTAuOTgzLDExLjUzLTEwLjk4M1Y0MzMuOGE2LjMyMSw2LjMyMSwwLDAsMCwwLDEyLjY0MXY0LjU3WiIgZmlsbD0iI2JhMTYyOCIgZmlsbC1ydWxlPSJldmVub2RkIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTY1MSAtNDI5KSI+CiA8L3BhdGg+Cjwvc3ZnPg==';
    ?>
    <style>
    .pg-vivino-rating {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        font-family: inherit;
        background: #fff;
        border-radius: 12px;
        padding: 14px 16px 12px;
        text-align: center;
        min-width: 110px;
        box-shadow: 0 2px 10px rgba(66,115,189,.1);

        /* Desktop: absoluut, top via JS, horizontaal op ~58% van de container */
        position: absolute;
        left: 58%;
        z-index: 10;
    }
    /* Mobiel: normaal in de flow, na de winkelwagen-knop */
    @media (max-width: 991px) {
        .pg-vivino-rating {
            position: relative;
            top: auto !important;
            right: auto;
            display: inline-flex;
            margin: 12px 0 16px;
        }
    }
    .pg-vivino-score {
        font-size: 30px;
        font-weight: 700;
        color: #222;
        line-height: 1;
        letter-spacing: -1px;
    }
    .pg-vivino-stars-wrap {
        position: relative;
        display: inline-block;
        font-size: 16px;
        letter-spacing: 2px;
        line-height: 1;
        margin: 2px 0;
    }
    .pg-vivino-stars-empty { color: #ddd; }
    .pg-vivino-stars-filled {
        position: absolute;
        left: 0; top: 0;
        overflow: hidden;
        white-space: nowrap;
        color: #7b1f2e;
    }
    .pg-vivino-count {
        font-size: 11.5px;
        color: #888;
        line-height: 1;
    }
    .pg-vivino-logo {
        width: 38px;
        height: auto;
        margin-top: 5px;
        opacity: .7;
    }
    </style>

    <script>
    (function() {
        var LOGO = 'data:image/svg+xml;base64,<?php echo $logo_b64; ?>';

        var html = '<div class="pg-vivino-rating">'
            + '<span class="pg-vivino-score"><?php echo esc_js( $score_nl ); ?></span>'
            + '<span class="pg-vivino-stars-wrap">'
            +   '<span class="pg-vivino-stars-empty">★★★★★</span>'
            +   '<span class="pg-vivino-stars-filled" style="width:<?php echo esc_attr( $pct ); ?>%">★★★★★</span>'
            + '</span>'
            + '<?php if ( $count_str ) echo "<span class=\"pg-vivino-count\">{$count_str}</span>"; ?>'
            + '<img class="pg-vivino-logo" src="' + LOGO + '" alt="Vivino">'
            + '</div>';

        function inject() {
            if (document.querySelector('.pg-vivino-rating')) return;

            var container = document.querySelector('.product__content')
                         || document.querySelector('.summary');

            if (window.innerWidth > 991) {
                // Desktop: absoluut rechts, top uitgelijnd met de prijs
                var price = document.querySelector('.product__price')
                         || document.querySelector('.price');
                if (container) {
                    var cs = window.getComputedStyle(container);
                    if (cs.position === 'static') container.style.position = 'relative';
                    container.insertAdjacentHTML('beforeend', html);
                    if (price) {
                        var priceRect     = price.getBoundingClientRect();
                        var containerRect = container.getBoundingClientRect();
                        var topOffset     = Math.round(priceRect.top - containerRect.top);
                        container.querySelector('.pg-vivino-rating').style.top = topOffset + 'px';
                    }
                }
            } else {
                // Mobiel: inject NA form.cart (onder de winkelwagen-knop)
                var cartForm = document.querySelector('form.cart');
                if (cartForm) {
                    cartForm.insertAdjacentHTML('afterend', html);
                } else if (container) {
                    container.insertAdjacentHTML('beforeend', html);
                }
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', inject);
        } else {
            inject();
        }
    })();
    </script>
    <?php
}
