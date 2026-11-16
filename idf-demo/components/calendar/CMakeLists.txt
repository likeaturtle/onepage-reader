idf_component_register(
    SRCS "src/calendar.c"
    INCLUDE_DIRS "include"
    REQUIRES
        esp_common
    PRIV_REQUIRES
        littlefs
        nvs_flash
        esp_hw_support
)
