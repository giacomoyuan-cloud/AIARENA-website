package com.pickandcase.assistant;
import org.junit.Test;
import static org.junit.Assert.*;
public class OriginPolicyTest {
    @Test public void exactHttpsOriginOnly(){
        assertTrue(OriginPolicy.trusted("https://ai.pickandcase.com/"));
        assertTrue(OriginPolicy.trusted("https://ai.pickandcase.com:443/path?x=1"));
        for(String url:new String[]{"http://ai.pickandcase.com/","https://ai.pickandcase.com.evil.test/","https://evil.test/ai.pickandcase.com","https://ai.pickandcase.com@evil.test/","https://user@ai.pickandcase.com/","https://ai.pickandcase.com:444/","file:///","javascript:alert(1)","https://ai.pickandcase.com\\@evil.test/","null"})assertFalse(url,OriginPolicy.trusted(url));
    }
}
