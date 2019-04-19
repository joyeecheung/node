#include "node_test_fixture.h"

ArrayBufferUniquePtr NodeTestFixtureBase::allocator{nullptr, nullptr};
uv_loop_t NodeTestFixtureBase::current_loop;
NodePlatformUniquePtr NodeTestFixtureBase::platform;
TracingAgentUniquePtr NodeTestFixtureBase::tracing_agent;
bool NodeTestFixtureBase::node_initialized = false;
