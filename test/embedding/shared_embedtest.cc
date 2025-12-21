#include <libplatform/libplatform.h>
#include <v8.h>

int main(int argc, char* argv[]){
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
}
