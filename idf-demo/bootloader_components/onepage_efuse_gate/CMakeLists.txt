# Bootloader component: see efuse_blk_check_wrap.c for why this exists.
#
# Everything in bootloader_components/ is compiled and linked into the
# bootloader rather than the application, which is the only way a plain
# ESP-IDF project can add a link flag to the bootloader. INTERFACE link
# libraries are how the IDF examples (e.g.
# examples/storage/custom_flash_driver) push such flags onto that link line.
idf_component_register(SRCS "efuse_blk_check_wrap.c")

target_link_libraries(${COMPONENT_LIB} INTERFACE
    "-Wl,--wrap=bootloader_common_check_efuse_blk_validity"
    "-u __wrap_bootloader_common_check_efuse_blk_validity")
