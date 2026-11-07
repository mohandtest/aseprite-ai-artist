return function(check,withMockSprite,call,eq)
  local function request(command,inner,token)
    return {command=command,args=inner,token=token or "00000000-0000-4000-8000-000000000001"}
  end
  check("image transport renders editor-local PNGs without changing artwork",function()
    withMockSprite(8,8,nil,function(s)
      local layer=s.layers[1].name
      call("draw.batch",{sprite="#"..s.id,layer=layer,paletteLock=false,ops={{kind="pixels",color="#ffffff",points={{x=2,y=3}}}}})
      local before=call("pixels.read",{sprite="#"..s.id,layer=layer,composite=false}).fingerprint
      for _,command in ipairs({"look.preview","look.preview.annotated","look.filmstrip","look.onion","draw.guarded"}) do
        local inner={sprite="#"..s.id,layer=layer,frame=1,scale=4,path="Z:\\not-shared\\bad.png",previewPath="/not-shared/invalid.png"}
        if command=="look.preview.annotated" then inner.overlays={grid=true,rulers=true,checkerboard=true,bounds=true} end
        if command=="draw.guarded" then
          inner.mode="preview";inner.paletteLock=false
          inner.ops={{kind="pixels",color="#ff0000",points={{x=1,y=1}}}}
        end
        local result=call("image.capture",request(command,inner))
        assert(result.image.data:sub(1,11)=="iVBORw0KGgo","PNG bytes absent for "..command)
        eq(result.image.mimeType,"image/png","MIME type")
        eq(call("pixels.read",{sprite="#"..s.id,layer=layer,composite=false}).fingerprint,before,"preview changed pixels")
      end
    end)
  end)
  check("image transport cleans editor-local files on success and renderer failure",function()
    local handlers=_G.AI_ARTIST.handlers
    local original=handlers["look.preview"]
    local temporary
    local token="00000000-0000-4000-8000-000000000002"
    local ok,err=pcall(function()
      for _,fail in ipairs({false,true}) do
        handlers["look.preview"]=function(args)
          temporary=args.path
          assert(temporary:find(app.fs.tempPath,1,true)==1,"Not an editor-local temp path")
          local f=assert(io.open(temporary,"wb"));f:write("\137PNG\r\n\26\n".."binary-test");f:close()
          if fail then error("renderer failure") end
          return {sprite="fixture"}
        end
        local reply=_G.AI_ARTIST.handleCommand({id="capture",cmd="image.capture",args=request("look.preview",{path="/wsl/path.png"},token)})
        eq(reply.ok,not fail,"capture result")
        local file=io.open(temporary,"rb")
        if file then file:close();error("Temporary PNG leaked") end
      end
    end)
    handlers["look.preview"]=original
    if not ok then error(err,0) end
  end)
  check("image capture refuses mutation commands and unsafe temporary names",function()
    withMockSprite(8,8,nil,function(s)
      for _,args in ipairs({
        request("draw.batch",{sprite="#"..s.id}),
        request("draw.guarded",{sprite="#"..s.id,mode="apply"}),
        request("look.preview",{sprite="#"..s.id},"../../other.png"),
      }) do
        local reply=_G.AI_ARTIST.handleCommand({id="capture",cmd="image.capture",args=args})
        assert(not reply.ok);eq(reply.error.code,"invalid_args","capture safety")
      end
    end)
  end)
  check("oversized capture fails before bridge transfer and cleans its file",function()
    local handlers=_G.AI_ARTIST.handlers
    local original=handlers["look.preview"]
    local temporary
    local ok,err=pcall(function()
      handlers["look.preview"]=function(args)
        temporary=args.path
        local file=assert(io.open(temporary,"wb"))
        file:write("\137PNG\r\n\26\n")
        assert(file:seek("set",8*1024*1024));file:write("x");file:close()
        return {sprite="fixture"}
      end
      local reply=_G.AI_ARTIST.handleCommand({id="capture",cmd="image.capture",args=request("look.preview",{},"00000000-0000-4000-8000-000000000003")})
      assert(not reply.ok);eq(reply.error.code,"too_large","capture size limit")
      local file=io.open(temporary,"rb");if file then file:close();error("Oversized PNG leaked") end
    end)
    handlers["look.preview"]=original
    if not ok then error(err,0) end
  end)

end
