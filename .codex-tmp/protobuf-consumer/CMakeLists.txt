cmake_minimum_required(VERSION 3.16)
project(protobuf_consumer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(protobuf CONFIG REQUIRED)

add_executable(protobuf_consumer main.cc)
target_link_libraries(protobuf_consumer PRIVATE protobuf::libprotobuf)
