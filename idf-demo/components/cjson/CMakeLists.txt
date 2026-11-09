idf_component_register(
    SRCS "cJSON.c"
    INCLUDE_DIRS "."
)

# The BLE protocol only uses shallow objects; bound the parser recursion so a
# malformed line cannot burn an unbounded amount of stack.
target_compile_definitions(${COMPONENT_LIB} PUBLIC CJSON_NESTING_LIMIT=32)
