#include <libplatform/libplatform.h>
#include <v8.h>
#include <cppgc/platform.h>

int main(int argc, char* argv[]){
  std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
  cppgc::InitializeProcess(platform->GetPageAllocator());


  cppgc::ShutdownProcess();
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
}
