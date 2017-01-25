$(document).ready(function() {

   var $gallery = $('.main-gallery').flickity({
      // options
      setGallerySize: false,
      wrapAround: false,
      lazyLoad: 4
         // imagesLoaded: true
   });

   var flkty = $gallery.data('flickity');

   var allProjects = [{
      id: 0,
      folderName: "dietrace/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png",
         "05.png",
         "06.png",
         "07.png",
         "08.png",
         "09.png",
         "10.png",
         "11.png"
      ]
   }, {
      id: 1,
      folderName: "xplenty/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
      ]
   }, {
      id: 2,
      folderName: "skinjournal/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png",
         "05.png",
         "06.png",
         "07.png",
         "08.png"
      ]
   }, {
      id: 3,
      folderName: "tlp/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png",
         "05.png"
      ]
   }, {
      id: 4,
      folderName: "advice-fp/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png"
      ]
   }, {
      id: 5,
      folderName: "5oosh/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png"
      ]
   }, {
      id: 6,
      folderName: "xrispi/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png"
      ]
   }, {
      id: 7,
      folderName: "splacer/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png",
         "05.png",
         "06.png"
      ]
   }, {
      id: 8,
      folderName: "dorbel/",
      counter: 0,
      files: [
         "00.png",
         "01.png",
         "02.png",
         "03.png",
         "04.png"
      ]
   }, ];



   var projectPath = "img/Projects/";


   $('.project-img-container').each(function() {
      $(this).on('click touchstart', function() {


         changeImage($(this).data('id'));
      });
   });


   function changeImage(project_id) {

      allProjects[project_id].counter++

         if (allProjects[project_id].counter > allProjects[project_id].files.length - 1) {
            allProjects[project_id].counter = 0;
         }
      var current_src = allProjects[project_id].folderName + allProjects[project_id].files[allProjects[project_id].counter]
      $("div[data-id=" + project_id + "]").find(".project-img").attr("src", "img/Projects/" + current_src);
   }

   preload_images(0);
   $gallery.on('cellSelect', function() {
      preload_images(flkty.selectedIndex);
   });

   function preload_images(current_project) {
      loadnext(allProjects[current_project].files, current_project);
   };

   function loadnext(jq2, project_id) {
      imgsrc = "img/Projects/" + allProjects[project_id].folderName + jq2[0];
      // console.log(imgsrc);
      myImage = new Image();
      myImage.onload = function() {

         (jq2 = jq2.slice(1)).length && loadnext(jq2, project_id);
      }
      myImage.src = imgsrc;
   };




});
