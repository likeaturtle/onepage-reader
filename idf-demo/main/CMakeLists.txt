idf_component_register(
    SRCS
        "main.c"
        "calendar_ui.c"
    INCLUDE_DIRS "."
    REQUIRES
        onepage_c61
        calendar
        ble_calendar
        esp_pm
        esp_timer
        esp_system
        nvs_flash
)
