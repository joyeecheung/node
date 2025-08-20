#include <assert.h>
#include <pthread.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

void* worker(void* data) {
  int* result = (int*) data;
  sleep(1);
  *result = 42;
  return NULL;
}

int main() {
  pthread_t thread = NULL;
  int result = 0;

  printf("Starting thread creation\n");
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 64 * 1024); // try 64–256 KiB
  int r = pthread_create(&thread, NULL, worker, &result);
  if (r != 0) {
    printf("pthread_create failed: %s\n", strerror(r));
  }
  assert(r == 0);

  r = pthread_join(thread, NULL);
  assert(r == 0);

  assert(result == 42);
  return 0;
}
