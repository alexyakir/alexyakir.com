$(document).ready(function(){function n(n){o[n].counter++,o[n].counter>o[n].files.length-1&&(o[n].counter=0);var e=o[n].folderName+o[n].files[o[n].counter];$("div[data-id="+n+"]").find(".project-img").attr("src","img/Projects/"+e)}function e(n){g(o[n].files,n)}function g(n,e){imgsrc="img/Projects/"+o[e].folderName+n[0],myImage=new Image,myImage.onload=function(){(n=n.slice(1)).length&&g(n,e)},myImage.src=imgsrc}var p=$(".main-gallery").flickity({setGallerySize:!1,wrapAround:!1,lazyLoad:4}),i=p.data("flickity"),o=[{id:0,folderName:"dietrace/",counter:0,files:["00.png","01.png","02.png","03.png","04.png","05.png","06.png","07.png","08.png","09.png","10.png","11.png"]},{id:1,folderName:"xplenty/",counter:0,files:["00.png","01.png","02.png","03.png"]},{id:2,folderName:"skinjournal/",counter:0,files:["00.png","01.png","02.png","03.png","04.png","05.png","06.png","07.png","08.png"]},{id:3,folderName:"tlp/",counter:0,files:["00.png","01.png","02.png","03.png","04.png","05.png"]},{id:4,folderName:"advice-fp/",counter:0,files:["00.png","01.png","02.png","03.png"]},{id:5,folderName:"5oosh/",counter:0,files:["00.png","01.png","02.png","03.png"]},{id:6,folderName:"xrispi/",counter:0,files:["00.png","01.png","02.png","03.png"]},{id:7,folderName:"splacer/",counter:0,files:["00.png","01.png","02.png","03.png","04.png","05.png","06.png"]},{id:8,folderName:"dorbel/",counter:0,files:["00.png","01.png","02.png","03.png","04.png"]},{id:9,folderName:"stupid-calc/",counter:0,files:["00.png"]}],r="img/Projects/";$(".project-img-container").each(function(){$(this).on("click touchstart",function(){n($(this).data("id"))})}),e(0),p.on("cellSelect",function(){e(i.selectedIndex)})});