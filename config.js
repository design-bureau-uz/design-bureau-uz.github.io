// Публичные данные проекта Supabase (anon key можно хранить открыто — доступ защищают правила базы).
window.APP_CONFIG = {
  SUPABASE_URL: "https://ctidnenonbaksksxppox.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0aWRuZW5vbmJha3Nrc3hwcG94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2ODk2NDAsImV4cCI6MjExMTI2NTY0MH0.-pcawSKqJpIlkPj65dk0QLrAwibdLlWM16SxnZ01w_s",
  BUREAU_NAME: "Объекты бюро"
};

// Защита от зависаний (особенно на iPhone после сворачивания браузера):
// 1) отключаем внутреннюю блокировку supabase-js, из-за которой запросы могли ждать бесконечно;
// 2) любой запрос к базе, не получивший ответа за 20 секунд, прерывается — форма не висит.
(function(){
  const sb = window.supabase;
  if(!sb || !sb.createClient) return;
  const noLock = async (name, acquireTimeout, fn) => await fn();
  window.supabase = Object.assign({}, sb, {
    createClient: (url, key, opts) => sb.createClient(url, key,
      Object.assign({}, opts, { auth: Object.assign({}, opts && opts.auth, { lock: noLock }) }))
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if(!/\.supabase\.co\/(rest|auth)\/v1/.test(url)) return origFetch(input, init);
    const ctl = new AbortController();
    const outer = init && init.signal;
    if(outer) outer.addEventListener("abort", () => ctl.abort());
    const timer = setTimeout(() => ctl.abort(), 20000);
    return origFetch(input, Object.assign({}, init, { signal: ctl.signal }))
      .catch(err => {
        if(ctl.signal.aborted && !(outer && outer.aborted)){
          setTimeout(() => {
            try{
              if(typeof toast === "function") toast("Сервер долго не отвечал. Обновил список — проверьте, не сохранилось ли уже.");
              document.dispatchEvent(new Event("visibilitychange"));
            }catch(e){}
          }, 300);
          throw new TypeError("Failed to fetch");
        }
        throw err;
      })
      .finally(() => clearTimeout(timer));
  };
})();
