# Kurgu Canavarı — V4 Eksikleri Tamamlanmış

GitHub Pages'e doğrudan yüklenebilir.

## Bu sürümde düzeltilenler
- 9:16, 16:9, 1:1 ve 4:5 çıktı formatları
- Karışık otomatik Zoom In / Zoom Out / Pan / Sabit hareket
- Hareketler sahne bazında atanır
- SRT olmadan da otomatik sahne oluşturma
- SRT varsa zaman kodları doğrudan sahnelere bağlanır
- Görsel + MP4 video sahneleri birlikte desteklenir
- MP4/WebM render
- Ses varsa çıktıya eklenir; ses olmadan da video render edilebilir
- 24/30/60 FPS
- Fade / Slide / Zoom geçişleri
- Siyah-beyaz / sinema / sıcak / vignette efektleri

## İlk görsel render düzeltmesi
- Render başında ilk sahnenin ilk karesi iki animation frame ile hazırlanır.
- MediaRecorder başlatıldıktan sonra ilk kare tekrar canvas'a çizilir.
- Render saati kayıt başladıktan sonra başlatılır; ilk görselin milisaniyelik atlanması engellenir.
- Render sırasında video sahneleri başlangıçta sıfırlanır ve son kare kontrollü şekilde kapatılır.

## SharedArrayBuffer / mobil Opera düzeltmesi
- MP4 FFmpeg çekirdeği `@ffmpeg/core-st` tek iş parçacıklı sürüme geçirildi.
- Bu sürüm GitHub Pages ve mobil Opera'da SharedArrayBuffer gerektirmez.
- MP4 motoru yine yüklenemezse render sonucu kaybolmaz; otomatik olarak WebM indirme bağlantısı sunulur.

## Son render düzeltmesi
- SRT ilk sahnesi 0 saniyeden başlar ve her sahne en az 250 ms sürer; ilk görselin flaş yapması engellenir.
- MP4 dışa aktarma `@ffmpeg/ffmpeg@0.11.6` ve uyumlu `core-st@0.11.1` API'sine geçirildi.
- Gerçek MP4 dosyası oluşmadan MP4 indirme bağlantısı gösterilmez.

## V7 özellikleri ve render düzeni
- Gerçek Zoom In, Gerçek Zoom Out, Karışık Zoom In/Out ve Zoom kapalı seçenekleri.
- Yumuşak Crossfade/Fade ve 0,25 / 0,5 / 0,75 / 1 saniye fade süresi seçimi.
- SRT altyazıları seçilen stil ile canvas üzerine görüntü olarak gömülür.
- Tek master clock ile görseller sırayla 1 → 2 → 3 ... şeklinde render edilir; kayıt öncesi eski canvas karesi temizlenir.
- Render sonrası MP4/WebM video önizlemesi gösterilir.
- Dikey 9:16, yatay 16:9, 720p/1080p ve 24/30/60 FPS seçenekleri korunur.


## V9 ilk görsel tekrar düzeltmesi
- Timeline medya/görsel sayısına sabitlenir; fazla SRT bloğu ilk görseli başa saramaz.
- SRT zaman boşluklarında `sceneAt` artık 1. sahneye dönmez; o ana kadar başlayan son sahneyi korur.
- Fade/slide/zoom geçişleri yalnızca gerçek sahne başlangıcında uygulanır.


## V10 deterministik geçiş düzeltmesi
- Crossfade, slide ve zoom geçişlerinde önceki sahne artık mevcut zamanla değil kendi son karesiyle çizilir.
- Render clock seçilen FPS'e kuantalanır; zaman geriye sıçrayıp ilk görseli tekrar seçemez.
- Her karede canvas temizlenerek yalnızca o frame'in sahneleri çizilir.


## V11 tek timeline render çekirdeği
- Render sistemi baştan tek, monotonik master clock ile yeniden düzenlendi.
- Her frame yalnızca kendi zaman aralığındaki tek görseli canvas'a çizer.
- Sonraki görsel başladığında önceki görselin `drawScene` çağrısı yapılmaz.
- Crossfade kaldırıldı; Fade seçeneği yalnızca yeni aktif görselin fade-in efektidir.
- Render zamanı gerçek saatten değil, `frameNo / FPS` dizisinden üretilir; ilk görselin tekrar yakalanması mümkün değildir.


## V12 ses master clock senkronizasyonu
- Sesli renderda `audio.currentTime` görüntü, SRT ve sahne timeline'ının master clock'udur.
- MediaRecorder ses başladıktan sonra başlatılır; ilk video karesi sesin 0. saniyesine bağlanır.
- Ses yoksa `performance.now()` tabanlı fallback clock kullanılır.
- Render bitişi ses saatine göre belirlenir; ses-video süresi ayrışmaz.
