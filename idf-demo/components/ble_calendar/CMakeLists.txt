idf_component_register(
    SRCS "src/ble_calendar.c"
    INCLUDE_DIRS "include"
    REQUIRES
        bt
        cjson
        calendar
        esp_common
    PRIV_REQUIRES
        esp_timer
        esp_hw_support
)
