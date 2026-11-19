idf_component_register(
    SRCS "src/ble_calendar.c" "src/ble_auth.c"
    INCLUDE_DIRS "include"
    REQUIRES
        bt
        brand
        cjson
        calendar
        esp_common
    PRIV_REQUIRES
        esp_timer
        esp_hw_support
        esp_app_format
        mbedtls
        nvs_flash
)
