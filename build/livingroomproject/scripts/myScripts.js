
		$(function()
		{

			fullscreen();
			 $(window).resize(fullscreen);        

			////////
			

			var audio = $(".swooshSound")[0];

			$(".press-sound").mousedown(function() {
				audio.play();
			});

			$(".nav-one").mouseenter(function() {
				audio.play();
			});

			$(".press-sound").mouseenter(function() {
				$(this).find(".arrow_box").css("display","block");
				$(this).find(".arrow_box").animate({
						opacity : '1'
					}, 100);
			});

			$(".press-sound").mouseleave(function() {
				$(this).find(".arrow_box").css("display","none");
				$(".arrow_box").animate({
						opacity : '0'
					}, 100);
			});

			$(".objDescContainer").mouseenter(function() {
				$(this).find(".arrow_box").css("display","block");
				$(this).find(".arrow_box").animate({
						opacity : '1'
					}, 100);
			});
			
			$(".objDescContainer").mouseleave(function() {
				$(this).find(".arrow_box").css("display","none");
				$(".arrow_box").animate({
						opacity : '0'
					}, 100);
			});

			$(".writtenLink").mouseover(function() {
				$(this).find(".linkTooltip").css("display","block");
				$(this).find(".linkTooltip").animate({
						opacity : '1'
					}, 100);
			});

			$(".writtenLink").mouseleave(function() {
				$(this).find(".linkTooltip").css("display","none");
				$(this).find(".linkTooltip").animate({
						opacity : '0'
					}, 100);
			});

			$(".nan").mousedown(function(event) {
				$(".alertBox").css("display","block");
				$(".alertBox").animate({
						opacity : '0.9'
					}, 100);
			});

			$('.closeAlert').mousedown(function() {
				$(".alertBox").css("display","none");
				$(".alertBox").animate({
						opacity : '0'
					}, 100);
			});

			// $('.alertBox').click(function() {
			//    $('.alertBox').hide();
			// });
			
			//  $('.alertBox').click(function(event){
			//     event.stopPropagation();
			// });


		});

		function fullscreen(){
		  screen_h = $('#mainContainer').height() - 91;
		  screen_w = $('#mainContainer').width();
		  $('.livingRoom').height(screen_h);
		  $('.lvimg').each(function(){
		    var img_w = $(this).attr('width');
		    var img_h = $(this).attr('height');
		    var factor = screen_w/img_w;
		    if ((img_h*factor)<screen_h){
		    	$(this).css({'width':screen_w, 'height':'auto'});
		    	$(this).parent().css('top',(screen_h - img_h * factor) / 2);
		    }else{
		    	$(this).css({'width':'auto', 'height':screen_h});
		    	factor = screen_h/img_h;
		    	$(this).parent().css('left',(screen_w - img_w * factor) / 2);
		    }	
		  });
		} 



	
